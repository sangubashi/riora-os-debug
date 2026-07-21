/**
 * detectNotifications.ts — アプリ内通知 v1 検出ロジック(純粋関数・DB非依存)
 *
 * Riora_アプリ内通知v1_祝福気遣いカード_設計書_v1.0.md 準拠。
 * 既存テーブルの実データのみを入力として受け取り、通知候補を計算する。
 * notificationsテーブルは作らない(migration禁止)ため、既読/未読・重複抑制・
 * 7日expire等の永続的な状態は持たない。呼び出しの都度、現時点の状態を
 * そのまま返す設計(ステートレス)。
 *
 * データ源:
 *   誕生日        customer_memories(memory_type='anniversary', trigger_date)
 *                 ※月日を毎年繰り返すものとして扱う(年は無視)。
 *                 content に「誕生日」を含む場合のみ誕生日として扱う
 *                 (memory_typeだけでは誕生日と他の記念日を区別できないため、
 *                 誤検出を避ける保守的な判定。PII_MINIMUM_POLICY_V1.md §5.4の
 *                 既知の制約を踏まえた設計)。
 *   記念日        brain_customers.first_visit_date(初回来店+365日地点。§3-3、単発)
 *   結婚式        brain_customers.wedding_date(PatternContextBuilder.tsの
 *                 weddingDaysLeft算出式と同一ロジックを再利用)
 *   ホームケア3タッチ brain_visits.retail_category(商品ごとの最終購入日)+
 *                 productDurationEstimate.ts(商品カテゴリ別の使い切り目安日数、
 *                 §3-5準拠の暫定辞書)。①購入当日 ②+7日 ③使い切り目安の85〜90%地点、
 *                 の3タッチのみを対象とし、状態(発火回数)を一切保存しない。各タッチに
 *                 狭い日数ウィンドウを設けることで、都度計算方式のままでも
 *                 「1商品あたり最大3回」が自然に成立する設計(詳細はファイル内コメント)。
 *   来店なし60日   brain_visits.visit_date の最終来店日
 *   肌状態改善中   brain_skin_records.primary_delta(直近2件の平均トレンド。
 *                 PatternContextBuilder.tsのskinImproved判定と同一ロジック)
 */
import type { NotificationKind, StaffNotification } from '@/types/notifications'
import { estimateProductDuration } from '@/lib/homecare/productDurationEstimate'

const MS_PER_DAY = 86_400_000

export interface NotificationCustomerInput {
  id:           string
  name:         string
  weddingDate:  string | null
  firstVisitDate: string | null
  lastVisitDate: string | null
  memories:     Array<{ memoryType: string; triggerDate: string | null; content: string }>
  retailProductCounts: Map<string, { count: number; lastPurchasedAt: string }>
  skinPrimaryDeltas: number[] // 古い順。直近2件の平均で判定
  /** 来店日前後停止の判定用。過去の来店日(brain_visits.visit_date)＋未来の予約日
   *  (reservations.scheduled_at)をまとめたもの。「会えるから」通知を止める設計
   *  (§3-5)のため、購入サイクルとは無関係に「今日」がこれらの近くかどうかだけを見る。 */
  nearbyVisitDates: string[]
}

const BIRTHDAY_WINDOW_DAYS = 7   // 「来週お誕生日です」
const WEDDING_WINDOW_DAYS  = 30  // 「結婚式まで30日」
const NO_VISIT_THRESHOLD_DAYS = 60
const ANNIVERSARY_TARGET_DAYS = 365 // §3-3: 初回来店1年(単発。2年目以降は対象外)
const ANNIVERSARY_WINDOW_DAYS = 3   // 365日地点の前後何日を許容するか(要運用調整)

// ── ホームケア3タッチ: 日数ウィンドウ(要運用調整) ──────────────────────────
const HOMECARE_DAY0_WINDOW_DAYS      = 1 // ①購入当日〜+1日のみ
const HOMECARE_CHECKIN_CENTER_DAYS   = 7 // ②
const HOMECARE_CHECKIN_WINDOW_DAYS   = 1 // ②の許容幅(6〜8日)
const HOMECARE_REPLENISH_MARGIN_DAYS = 2 // ③(85〜90%地点)の前後の許容幅
const VISIT_BLACKOUT_DAYS            = 3 // 来店日/予約日の前後何日を停止するか

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** trigger_date の月日を「今年以降で直近の出現日」に読み替えて今日からの日数を返す(年をまたぐ誕生日にも対応)。 */
function daysUntilAnnualRecurrence(triggerDate: string, today: Date): number | null {
  const t = new Date(triggerDate)
  if (Number.isNaN(t.getTime())) return null
  const base = startOfDay(today)
  let next = new Date(base.getFullYear(), t.getMonth(), t.getDate())
  if (next.getTime() < base.getTime()) {
    next = new Date(base.getFullYear() + 1, t.getMonth(), t.getDate())
  }
  return Math.round((next.getTime() - base.getTime()) / MS_PER_DAY)
}

function daysUntil(dateStr: string, today: Date): number {
  const d = startOfDay(new Date(dateStr))
  const base = startOfDay(today)
  return Math.round((d.getTime() - base.getTime()) / MS_PER_DAY)
}

function daysSince(dateStr: string, today: Date): number {
  return -daysUntil(dateStr, today)
}

function makeId(kind: NotificationKind, customerId: string): string {
  return `${kind}:${customerId}`
}

/** 「今日」が来店日/予約日のいずれかから±VISIT_BLACKOUT_DAYS以内かどうか(来店日前後停止・§3-5)。 */
function isNearAnyVisitDate(dates: string[], today: Date): boolean {
  const base = startOfDay(today).getTime()
  return dates.some((d) => {
    const t = new Date(d)
    if (Number.isNaN(t.getTime())) return false
    const diffDays = Math.abs((startOfDay(t).getTime() - base) / MS_PER_DAY)
    return diffDays <= VISIT_BLACKOUT_DAYS
  })
}

/** 単一顧客について、通知条件に該当するものを全て返す(0件の場合もある)。 */
export function detectNotificationsForCustomer(
  customer: NotificationCustomerInput,
  today: Date = new Date()
): StaffNotification[] {
  const results: StaffNotification[] = []

  // ── 🎂 誕生日 ──────────────────────────────────────────────────────────
  for (const m of customer.memories) {
    if (m.memoryType !== 'anniversary' || !m.triggerDate) continue
    if (!m.content.includes('誕生日')) continue
    const days = daysUntilAnnualRecurrence(m.triggerDate, today)
    if (days !== null && days >= 0 && days <= BIRTHDAY_WINDOW_DAYS) {
      results.push({
        id: makeId('birthday', customer.id),
        kind: 'birthday',
        emoji: '🎂',
        title: days === 0 ? `${customer.name}様 本日お誕生日です` : `${customer.name}様 来週お誕生日です`,
        customerId: customer.id,
        customerName: customer.name,
      })
      break // 同一顧客で複数の誕生日メモがあっても通知は1件
    }
  }

  // ── 🎉 記念日(初回来店1年、§3-3) ────────────────────────────────────────
  // 単発の節目として扱う(2年目以降は対象外。設計書§3-3の「初来店から1年」の例に準拠)。
  if (customer.firstVisitDate) {
    const daysSinceFirstVisit = daysSince(customer.firstVisitDate, today)
    if (Math.abs(daysSinceFirstVisit - ANNIVERSARY_TARGET_DAYS) <= ANNIVERSARY_WINDOW_DAYS) {
      results.push({
        id: makeId('anniversary_visit', customer.id),
        kind: 'anniversary_visit',
        emoji: '🎉',
        title: `${customer.name}様 初来店から1年です`,
        customerId: customer.id,
        customerName: customer.name,
      })
    }
  }

  // ── 💍 結婚式 ──────────────────────────────────────────────────────────
  if (customer.weddingDate) {
    const days = daysUntil(customer.weddingDate, today)
    if (days >= 0 && days <= WEDDING_WINDOW_DAYS) {
      results.push({
        id: makeId('wedding', customer.id),
        kind: 'wedding',
        emoji: '💍',
        title: `${customer.name}様 結婚式まで${days}日`,
        customerId: customer.id,
        customerName: customer.name,
      })
    }
  }

  // ── 🧴 ホームケア3タッチ(①使い方カード ②使い心地確認 ③補充前) ─────────
  //
  // 状態(何回発火したか)は一切保存しない。①②③それぞれに狭い日数ウィンドウを
  // 設け、「今日がそのウィンドウ内かどうか」だけを都度判定することで、
  // 1商品あたり最大3回(①②③各1回ずつ)が自然に守られる設計。
  const isNearVisit = isNearAnyVisitDate(customer.nearbyVisitDates, today)
  if (!isNearVisit) {
    interface HomecareCandidate {
      kind:     'homecare_usage_guide' | 'homecare_checkin' | 'homecare_replenish'
      priority: number // 小さいほど優先(同日集中回避で1件に絞る際に使う)
      productName: string
      title:    string
    }
    const candidates: HomecareCandidate[] = []

    const productEntries = Array.from(customer.retailProductCounts.entries())
    for (const [name, info] of productEntries) {
      const daysSincePurchase = daysSince(info.lastPurchasedAt, today)
      if (daysSincePurchase < 0) continue // 未来日は無視(データ異常への防御)

      if (daysSincePurchase <= HOMECARE_DAY0_WINDOW_DAYS) {
        candidates.push({
          kind: 'homecare_usage_guide', priority: 1, productName: name,
          title: `${customer.name}様 ${name} 使い方カード`,
        })
      }
      if (
        daysSincePurchase >= HOMECARE_CHECKIN_CENTER_DAYS - HOMECARE_CHECKIN_WINDOW_DAYS &&
        daysSincePurchase <= HOMECARE_CHECKIN_CENTER_DAYS + HOMECARE_CHECKIN_WINDOW_DAYS
      ) {
        candidates.push({
          kind: 'homecare_checkin', priority: 2, productName: name,
          title: `${customer.name}様 ${name} 使い心地はいかがですか`,
        })
      }
      const duration = estimateProductDuration(name)
      if (duration) {
        const lower = Math.round(duration.durationDays * 0.85) - HOMECARE_REPLENISH_MARGIN_DAYS
        const upper = Math.round(duration.durationDays * 0.90) + HOMECARE_REPLENISH_MARGIN_DAYS
        if (daysSincePurchase >= lower && daysSincePurchase <= upper) {
          candidates.push({
            kind: 'homecare_replenish', priority: 3, productName: name,
            title: `${customer.name}様 ${name} そろそろ補充の頃`,
          })
        }
      }
    }

    // 同日集中回避: 複数商品が同時にウィンドウへ入っても1件のみ表示する
    // (①使い方 > ②確認 > ③補充の優先順で1件を選ぶ。残りは翌日以降に持ち越される)
    if (candidates.length > 0) {
      candidates.sort((a, b) => a.priority - b.priority)
      const chosen = candidates[0]
      results.push({
        id: makeId(chosen.kind, customer.id) + ':' + chosen.productName,
        kind: chosen.kind,
        emoji: '🧴',
        title: chosen.title,
        customerId: customer.id,
        customerName: customer.name,
      })
    }
  }

  // ── 📅 来店なし60日 ───────────────────────────────────────────────────
  if (customer.lastVisitDate) {
    const days = daysSince(customer.lastVisitDate, today)
    if (days >= NO_VISIT_THRESHOLD_DAYS) {
      results.push({
        id: makeId('no_visit_60', customer.id),
        kind: 'no_visit_60',
        emoji: '📅',
        title: `${customer.name}様 ${days}日来店なし`,
        customerId: customer.id,
        customerName: customer.name,
      })
    }
  }

  // ── 🌱 肌状態改善中 ───────────────────────────────────────────────────
  const lastTwo = customer.skinPrimaryDeltas.slice(-2)
  if (lastTwo.length > 0) {
    const trend = lastTwo.reduce((sum, d) => sum + d, 0) / lastTwo.length
    if (trend > 0) {
      results.push({
        id: makeId('skin_improving', customer.id),
        kind: 'skin_improving',
        emoji: '🌱',
        title: `${customer.name}様 肌状態改善中`,
        customerId: customer.id,
        customerName: customer.name,
      })
    }
  }

  return results
}

/** 複数顧客をまとめて検出する(通知一覧画面用)。 */
export function detectNotifications(
  customers: NotificationCustomerInput[],
  today: Date = new Date()
): StaffNotification[] {
  const all: StaffNotification[] = []
  for (const c of customers) {
    all.push(...detectNotificationsForCustomer(c, today))
  }
  return all
}
