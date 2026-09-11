/**
 * nextVisitEngine.ts — 次回目安エンジン(PHASE NEXT-VISIT-1・2026-09-11)。
 *
 * ルールベースのみ(LLM不使用)。優先順位:
 *   ①担当スタッフの手動上書き(brain_customers.next_visit_override_date)
 *   ②次回予約が既に入っている場合はその日時
 *   ③直近来店(最大5件)の間隔の中央値から算出
 *   ④来店が1回以下でデータ不足の場合はメニュー別デフォルト日数(getMenuCycleDays)
 *
 * 支払形態(都度払い／サブスク／回数券)について(READ ONLY調査2026-09-11で確認済み):
 *   サブスク(is_subscriber/brain_subscriptions)は本番0件、回数券は該当データが
 *   DBのどこにも存在しない。実データで分岐させる根拠が無いため、算出ロジック自体は
 *   全顧客共通(③の間隔中央値)とし、payment_typeは根拠テキストへの付記のみに使う
 *   (is_subscriber=trueの顧客にのみ「サブスクご契約に基づく」旨を付記)。回数券は
 *   判定手段が無いため現状は常にfalseで、将来データが入った場合の拡張ポイントとして
 *   型だけ用意しておく。
 *
 * 純粋関数のみ(DB非依存・UI非依存)。日付はすべて"YYYY-MM-DD"のISO日付文字列で扱う。
 */

export type PaymentType = 'per_visit' | 'subscription' | 'ticket'

export type NextVisitSource =
  | 'staff_override'
  | 'next_reservation'
  | 'interval_calculated'
  | 'menu_default'
  | 'insufficient_data'

export interface NextVisitInput {
  /** brain_customers.next_visit_override_date。担当スタッフが手動設定した日付(最優先)。 */
  overrideDate: string | null
  /** 直近の未来予約(reservations.scheduled_at, status<>'cancelled')の日付。無ければnull。 */
  nextReservationDate: string | null
  /** 過去の来店日(brain_visits.visit_date)。順不同で渡してよい(内部でソートする)。 */
  visitDates: string[]
  /** 直近来店(または本日)のメニュー名。④のフォールバックにのみ使う。 */
  currentMenuName: string | null
  paymentType: PaymentType
}

export interface NextVisitResult {
  source: NextVisitSource
  /** 算出された目安日(ISO日付文字列)。データ不足時のみnull。 */
  estimatedDate: string | null
  /** 採用したサイクル日数。次回予約優先・スタッフ上書き優先の場合はnull。 */
  cycleDays: number | null
  /** 算出に使った来店件数(interval_calculated時のみ)。 */
  sampleSize: number | null
  /** 画面表示用の根拠テキスト(例:「過去3回の来店周期(中央値28日)を参考にしています」)。 */
  basisLabel: string
}

const MENU_CYCLE: Array<{ pattern: RegExp; days: number }> = [
  { pattern: /ハーブ.{0,4}ピーリング/, days: 21 },
  { pattern: /毛穴/, days: 28 },
  { pattern: /ポアクリーニング/, days: 28 },
  { pattern: /美白/, days: 30 },
  { pattern: /エイジング|コラーゲン/, days: 45 },
  { pattern: /プレミアム/, days: 45 },
  { pattern: /水光|ハイドラ|モイスチャー/, days: 30 },
  { pattern: /スキンケア|ベーシック/, days: 35 },
  { pattern: /UV|紫外線/, days: 28 },
  { pattern: /リラクゼーション/, days: 42 },
]

/** 既存のgetMenuCycleDays(src/lib/homecare/generateHomecarePlan.ts)と同一ロジック。
 *  ④のフォールバックでのみ使う独立コピー(次回目安エンジンをホームケア機能から
 *  独立させて他画面から呼びやすくするため)。 */
function menuDefaultCycleDays(menu: string): number {
  for (const { pattern, days } of MENU_CYCLE) {
    if (pattern.test(menu)) return days
  }
  return 35
}

/**
 * "YYYY-MM-DD"をUTC基準のDateとして解釈する。ローカルタイムゾーンで解釈すると
 * (例: new Date(dateStr+'T00:00:00'))、実行環境のタイムゾーンによって
 * toISOString()変換時に前後1日ずれるバグを引き起こすため、日付計算は
 * 必ずこの関数経由でUTC基準に統一する。
 */
function parseIsoDateUtc(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function addDays(dateStr: string, days: number): string {
  const d = parseIsoDateUtc(dateStr)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function daysBetween(fromStr: string, toStr: string): number {
  const from = parseIsoDateUtc(fromStr).getTime()
  const to = parseIsoDateUtc(toStr).getTime()
  return Math.round((to - from) / 86_400_000)
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid]
}

/**
 * 直近来店(最大5件)の間隔の中央値からサイクル日数を算出する。
 * 来店が2件未満(間隔0件)の場合はnullを返す(呼び出し側で④にフォールバックする)。
 */
function computeIntervalCycle(visitDates: string[]): { cycleDays: number; sampleSize: number } | null {
  const sorted = [...visitDates].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)) // 降順(新しい順)
  const recent = sorted.slice(0, 5)
  if (recent.length < 2) return null

  const gaps: number[] = []
  for (let i = 0; i < recent.length - 1; i++) {
    gaps.push(daysBetween(recent[i + 1], recent[i]))
  }

  return { cycleDays: median(gaps), sampleSize: recent.length }
}

export function computeNextVisit(input: NextVisitInput): NextVisitResult {
  const { overrideDate, nextReservationDate, visitDates, currentMenuName, paymentType } = input

  // ① 手動上書き(最優先)
  if (overrideDate) {
    return {
      source: 'staff_override',
      estimatedDate: overrideDate,
      cycleDays: null,
      sampleSize: null,
      basisLabel: '担当スタッフが設定した目安です',
    }
  }

  // ② 次回予約
  if (nextReservationDate) {
    return {
      source: 'next_reservation',
      estimatedDate: nextReservationDate,
      cycleDays: null,
      sampleSize: null,
      basisLabel: '次回のご予約が入っています',
    }
  }

  const sortedVisits = [...visitDates].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
  const lastVisitDate = sortedVisits[0] ?? null

  // ③ 来店間隔の中央値
  const interval = computeIntervalCycle(visitDates)
  if (interval && lastVisitDate) {
    const subscriptionNote = paymentType === 'subscription' ? '(サブスクご契約に基づく参考値です)' : ''
    return {
      source: 'interval_calculated',
      estimatedDate: addDays(lastVisitDate, interval.cycleDays),
      cycleDays: interval.cycleDays,
      sampleSize: interval.sampleSize,
      basisLabel: `過去${interval.sampleSize}回の来店周期(中央値${interval.cycleDays}日)を参考にしています${subscriptionNote}`,
    }
  }

  // ④ メニュー別デフォルト(来店が1回以下でデータ不足)
  if (lastVisitDate) {
    const cycleDays = menuDefaultCycleDays(currentMenuName ?? '')
    return {
      source: 'menu_default',
      estimatedDate: addDays(lastVisitDate, cycleDays),
      cycleDays,
      sampleSize: 1,
      basisLabel: 'ご来店データが少ないため、メニューの標準的な目安でご案内しています',
    }
  }

  // 来店履歴が1件も無い
  return {
    source: 'insufficient_data',
    estimatedDate: null,
    cycleDays: null,
    sampleSize: null,
    basisLabel: 'まだ目安を算出できるデータがありません',
  }
}

/** 週数の目安表示("約4週間後"等)。日数からの単純な四捨五入。 */
export function formatWeeksLabel(daysFromToday: number): string {
  if (daysFromToday <= 0) return '本日以降'
  const weeks = Math.round(daysFromToday / 7)
  return weeks <= 0 ? 'まもなく' : `約${weeks}週間後`
}

/** "YYYY-MM-DD" → "6月9日頃"形式(表示専用の軽量ヘルパー)。 */
export function formatApproxDateLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`)
  return `${d.getMonth() + 1}月${d.getDate()}日頃`
}
