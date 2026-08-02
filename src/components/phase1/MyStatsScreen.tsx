'use client'
/**
 * MyStatsScreen — 「わたし」タブ（v1最小版）
 *
 * 他人比較・ランキングは一切行わない。表示は自分の実績のみ。
 * (Riora OS v1.0 再設計書 準拠)
 *
 * PHASE MYPAGE-LASTMONTH-SUMMARY(2026-07-30): 最上部に「先月の実績」カード(売上/来店人数/
 * 客単価/指名率/リピート率/LTV、数字のみ・AIコメント無し)を追加。「先週のよかったところ」は
 * 固定指標(指名/リピート率/店販のみ)から、売上・客単価も含めた5指標のうち先週比で最も
 * 改善した1つだけを表示する方式に変更し、AIコメントを改善指標に応じて変える方式にした
 * (staff別トーンから指標別トーンへ変更)。外舘の画面は既存方針どおり売上・客単価・店販を
 * 引き続き候補から除外。LTVは管理者ダッシュボード(StaffAnalyticsEngine.ltvOfCustomer)と
 * 同じ算出式(顧客の全履歴売上+継続中サブスク月額×6)を、既存のbrain_visits/
 * brain_subscriptionsから計算(新規テーブル・新規APIエンドポイントは追加していない)。
 *
 * PHASE MYPAGE-METRIC-LABELS(2026-07-30): 主役カードの数値に「リピート率」、指名カードの
 * 数値に「指名率」/「今月のご指名」ラベルを明示(数値のみだと何の指標か分からないため)。
 * 見出し・補足文言・トーン分岐ロジックは変更していない。
 *
 * PHASE MYPAGE-WEEKLY-PRAISE(2026-07-30): 「先週のよかったところ」を追加。
 * 先週比でプラスになった指標(指名/リピート率/店販。外舘は店販を候補から除外)のみを
 * 数字表示し、プラスが無ければ数字を出さず前向きな一文のみ表示する(マイナス・
 * 下落率は一切出さない)。トーンはstaff_id別(氏名文字列では判定しない)。
 * 週次データは既存の/api/me/monthly-statsに`weekly`フィールドを追加して取得
 * (新規APIは追加していない)。外舘の主役カード補足文を「店で一番多いです」表現に
 * 更新(本人の自信づけのため意図的に採用。他スタッフ画面には出さない・ユーザー指示)。
 *
 * PHASE MYPAGE-STAFF-VARIANT(2026-07-30): 主役カード(リピート率・絶対値)・
 * 指名カードをstaff_id別に出し分け(氏名文字列では一切判定しない。
 * /api/me/monthly-statsが返すbrain_staff.id(stats.staffId)のみで判定)。
 * 「明日の担当」に禁忌・重要メモを追加表示、「そろそろの方」はホームケア補充通知
 * (kind='homecare_replenish')に差し替え。来店数差分カードは表示しない。
 * UIデザイン(色・spacing・border-radius・カードサイズ・shadow・レイアウト・
 * タイポグラフィ)は既存のまま変更していない。API/DB/migrationの追加は無く、
 * 既存の/api/me/monthly-stats(staffId・nomination.rateフィールドを追加のみ)・
 * useNotificationsStoreを再利用している。
 *
 * PHASE STAFF-MYPAGE-PERSONALIZATION(2026-07-30・前フェーズ): 「先月比カード」を
 * 撤去し週次チェックリストを試験導入したが、本フェーズの主役/指名カードに置き換えた。
 *
 * PHASE MYPAGE-UX-1(2026-07-27・UI改善のみ): 今週予約サマリー(今日/明日)を追加。
 * 「今週残り(明後日以降)」はスタッフ本人に絞って取得できる既存データソースが無いため、
 * ユーザー承認のうえ今回は対象外(今日・明日のみ)としている。
 *
 * PHASE MYPAGE-METRICS-RETAIL(2026-08-02): 「先月の実績」カードのLTV表示を削除し、
 * 店販売上に差し替えた(行動につながる指標へ変更・ユーザー指示)。この時点ではLTVの
 * 算出ロジック(/api/me/monthly-stats側)・型・レスポンスフィールドは変更していない。
 *
 * PHASE STAFF-LTV-CLEANUP(2026-08-02): スタッフアプリ全体を再調査し、上記で表示から
 * 外したLTVがフロントエンドのどこからも参照されない完全なデッドコードだったと判明した
 * ため、/api/me/monthly-stats側のLTV算出ロジック・レスポンスフィールド・
 * useMyStatsStore.tsの型フィールドを削除した(ユーザー承認済み)。管理者ダッシュボード
 * (StaffAnalyticsEngine/CustomerAssetEngine)側のLTV機能・表示は完全に独立した別実装
 * のため無変更。
 *
 * PHASE MYPAGE-COMMENT-TIERING(2026-08-01): 「今月のひとこと」「指名カード」の文言が
 * 母数(件数)に関係なく同じ強さの表現になっていた不自然さを修正。指名カード(亀山)は
 * 指名件数(0/1〜3/4〜9/10件以上)で文言を段階化し、「戻ってきてくださる方が多い」という
 * 言い切りは実際のリピート率(50%以上)と十分な母数(今月の来店人数10人以上)がある場合
 * のみ表示する(小さな指名件数・少ない母数で誇張した表現を出さない)。「今月のひとこと」の
 * 指名・リピート率候補も同様に、指名件数/来店人数(母数)の段階に応じた表現の強さに
 * 変更した。売上・客単価・店販(金額ベースの指標)は今回のスコープ外として文言は変更していない。
 */
import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { CalendarDays, Sparkles, RefreshCw, Lock, Clock, Check } from 'lucide-react'
import AppBottomNav from './AppBottomNav'
import MyPageReservationsSheet, { extractVisitPhrase } from './MyPageReservationsSheet'
import ChangePasswordSheet from './ChangePasswordSheet'
import { useMyStatsStore, type WeeklyDiff, type MyStats } from '@/store/useMyStatsStore'
import { useHomeStore } from '@/store/useHomeStore'
import { useNotificationsStore } from '@/store/useNotificationsStore'
import { useAuthStore } from '@/store/useAuthStore'
import { useNewCustomerSheetStore } from '@/store/useNewCustomerSheetStore'
import { useCustomerStore, type CustomerRow } from '@/store/useCustomerStore'
import CustomerBottomSheet from '@/components/customer/CustomerBottomSheet'
import type { Customer as BSCustomer, Reservation as BSReservation } from '@/types'

// ─── スタッフ別出し分け(PHASE MYPAGE-STAFF-VARIANT) ───────────────────────────
//
// AUTH-1原則: 氏名文字列では一切分岐しない。brain_staff.id(stats.staffId)のみで判定する。
//
// PHASE MYPAGE-STAFFID-FIX(2026-07-30): 本番の/api/me/monthly-statsを実アカウントで
// 実測し、brain_staff.idを検証済み(978ba4be.../0688b0ec...は別のID空間(おそらく
// profiles.id/auth.users.id)を指すドキュメントの値を誤って参照していたバグ)。
// brain_staff(supabase/migrations/20260618_staff_roles_setup.sqlの一回限りシード)は
// 固定の00000000-...-01xx形式で作成されており、実測値と一致することを確認済み:
//   鈴木=...-0101(未使用・分岐対象外) 亀山=...-0102 外舘=...-0103
const SOTODATE_STAFF_ID = '00000000-0000-0000-0000-000000000103' // 外舘
const KAMEYAMA_STAFF_ID = '00000000-0000-0000-0000-000000000102' // 亀山

interface HeroContent {
  heading: string
  subtext: string
}

/**
 * 主役カード(リピート率・絶対値)の見出し・補足文(PHASE MYPAGE-DEMO-CLEANUP)。
 * 従来はstaffId別の固定文言だったが、実データ(今月−先月のリピート率diff)に置き換えた。
 * 改善(diff>0)が無ければ中立文言のみ表示し、架空の改善は作らない。
 */
function getHeroContent(stats: MyStats | null): HeroContent {
  const diff = stats?.repeatRate.diff ?? 0
  if (diff > 0) {
    return {
      heading: 'また戻ってきてくださるお客様が増えています',
      subtext: `先月よりリピート率が${diff}ポイント伸びています`,
    }
  }
  return { heading: 'リピート率', subtext: '今月のリピート率です' }
}

interface NominationContent {
  /** 'rate'=指名率(%・絶対値)、'count'=指名件数(実数のみ・下落率は出さない)。 */
  mode: 'rate' | 'count'
  lines: string[]
}

/** 指名件数(0/1〜3/4〜9/10件以上)の段階(PHASE MYPAGE-COMMENT-TIERING)。 */
function getCountTier(n: number): 'none' | 'low' | 'mid' | 'high' {
  if (n <= 0) return 'none'
  if (n <= 3) return 'low'
  if (n <= 9) return 'mid'
  return 'high'
}

/**
 * 指名カードの表示モード・補足文。
 * 亀山の補足文は指名件数の段階(0/1〜3/4〜9/10件以上)に応じて文言の強さを変える
 * (PHASE MYPAGE-COMMENT-TIERING)。「戻ってきてくださる方が多い」という言い切りは
 * 実際のリピート率が十分に高く(50%以上)、かつ算出根拠となる母数(今月の来店人数)が
 * 十分にある(10人以上)場合のみ表示し、母数が少ない場合は指名件数のみに基づく
 * 控えめな表現に切り替える(架空の「多い」を作らない)。
 */
function getNominationContent(staffId: string | null, stats: MyStats | null): NominationContent {
  if (staffId === SOTODATE_STAFF_ID) {
    return {
      mode: 'rate',
      lines: [
        '信頼されているから、あなたの一言はお客様に届きます',
        '次回のご案内やホームケアも、そっとお伝えしてみましょう',
      ],
    }
  }
  if (staffId === KAMEYAMA_STAFF_ID) {
    const count      = stats?.nomination.thisMonth ?? 0
    const visits     = stats?.visitCount.thisMonth ?? 0
    const repeatRate = stats?.repeatRate.thisMonth ?? null
    const canClaimManyRepeat = visits >= 10 && repeatRate !== null && repeatRate >= 50

    const tier = getCountTier(count)
    if (tier === 'none') {
      return { mode: 'count', lines: ['今月はまだご指名がありません。日々の接客の積み重ねが、次のご指名につながっていきます。'] }
    }
    if (tier === 'low') {
      return { mode: 'count', lines: ['ご指名をいただき始めています。日頃の接客がお客様に届いている証拠です。'] }
    }
    if (tier === 'mid') {
      return {
        mode: 'count',
        lines: [
          canClaimManyRepeat
            ? '戻ってきてくださる方が増えているあなたなら、次回のご来店を一言お伝えするだけで、ご指名にも自然と繋がっていきます。'
            : 'ご指名が着実に増えています。次回のご来店を一言お伝えすることが、さらなるご指名にも繋がります。',
        ],
      }
    }
    // tier === 'high'(10件以上)
    return {
      mode: 'count',
      lines: [
        canClaimManyRepeat
          ? '戻ってきてくださる方が多いあなたなら、次回のご来店を一言お伝えするだけで、ご指名にも自然と繋がっていきます。'
          : 'ご指名を多くいただいています。次回のご来店を一言お伝えすることが、さらなるご指名にも繋がります。',
      ],
    }
  }
  return { mode: 'count', lines: [] }
}

// ─── 先週のよかったところ(PHASE MYPAGE-LASTMONTH-SUMMARY) ─────────────────────

type WeeklyPraiseMetricKey = 'sales' | 'avgSpend' | 'nomination' | 'repeatRate' | 'retail'

interface WeeklyPraiseCandidate {
  key:   WeeklyPraiseMetricKey
  label: string
  diff:  number
  unit:  'yen' | 'count' | 'percent'
}

/** 先週比プラスの候補指標(売上・客単価・指名件数・リピート率・店販件数の5種)。
 *  外舘の画面には売上・客単価・店販を一切出さない既存方針を踏襲し、この3つを候補から
 *  除外する(ユーザー承認済み)。avgSpendDiffは今週・先週いずれかの来店が0件だとnullに
 *  なるため、その場合は候補に含めない(架空の客単価改善を作らない)。 */
function getWeeklyPraiseCandidates(staffId: string | null, weekly: WeeklyDiff): WeeklyPraiseCandidate[] {
  const candidates: WeeklyPraiseCandidate[] = [
    { key: 'nomination', label: 'ご指名',     diff: weekly.nominationDiff, unit: 'count' },
    { key: 'repeatRate', label: 'リピート率', diff: weekly.repeatRateDiff, unit: 'percent' },
  ]
  if (staffId !== SOTODATE_STAFF_ID) {
    candidates.push({ key: 'sales', label: '売上', diff: weekly.salesDiff, unit: 'yen' })
    if (weekly.avgSpendDiff !== null) {
      candidates.push({ key: 'avgSpend', label: '客単価', diff: weekly.avgSpendDiff, unit: 'yen' })
    }
    candidates.push({ key: 'retail', label: '店販', diff: weekly.retailCountDiff, unit: 'count' })
  }
  return candidates
}

function formatPraiseValue(diff: number, unit: WeeklyPraiseCandidate['unit']): string {
  if (unit === 'yen')     return `+¥${diff.toLocaleString('ja-JP')}`
  if (unit === 'percent') return `+${diff}%`
  return `+${diff}件`
}

/** 改善指標に応じたAIコメント(staffトーンではなく指標トーンで変える・ユーザー指示)。 */
const METRIC_COMMENTS: Record<WeeklyPraiseMetricKey, string[]> = {
  sales:      ['売上が伸びています。', '今の接客がお客様に届いています。'],
  avgSpend:   ['より質の高いご提案がお客様に届いています。'],
  nomination: ['あなたを選んでくださるお客様が増えています。'],
  repeatRate: ['あなたの技術がしっかり届いている証拠です。'],
  retail:     ['ホームケア提案がお客様に届いています。'],
}

const NO_PLUS_COMMENT = {
  sotodate: '今週も安心感のある接客がお客様に届いています。',
  kameyama: '今週も丁寧な技術でお客様と向き合っていきましょう。',
  default:  '今週も丁寧な接客を積み重ねていきましょう。',
} as const

interface WeeklyPraise {
  metric:   { label: string; text: string } | null
  comments: string[]
}

/**
 * 「先週のよかったところ」の表示内容を組み立てる。
 * プラスの指標だけを候補にし(マイナス・0は候補から除外)、最も改善した1つだけを表示する。
 * 該当が無ければ数字を出さずstaff別の前向きな一文のみを返す(嘘の0%・架空のプラスは
 * 一切作らない。diffは常にthisWeek-lastWeekの実測値のため、データ不足時は自然にdiff=0
 * となり「該当なし」分岐に落ちる)。
 */
function buildWeeklyPraise(staffId: string | null, weekly: WeeklyDiff): WeeklyPraise {
  const positives = getWeeklyPraiseCandidates(staffId, weekly)
    .filter((c) => c.diff > 0)
    .sort((a, b) => b.diff - a.diff)

  if (positives.length === 0) {
    const key = staffId === SOTODATE_STAFF_ID ? 'sotodate' : staffId === KAMEYAMA_STAFF_ID ? 'kameyama' : 'default'
    return { metric: null, comments: [NO_PLUS_COMMENT[key]] }
  }

  const top = positives[0]
  return {
    metric:   { label: top.label, text: formatPraiseValue(top.diff, top.unit) },
    comments: METRIC_COMMENTS[top.key],
  }
}

/** ¥表記(絶対値・マイナス表示なし)。「先月の実績」カード用。 */
function formatYen(value: number): string {
  return `¥${Math.round(value).toLocaleString('ja-JP')}`
}

type MonthlyCommentMetricKey = 'sales' | 'avgSpend' | 'nomination' | 'repeatRate' | 'retail'

interface MonthlyCommentCandidate {
  key:  MonthlyCommentMetricKey
  diff: number
  /** その候補が選ばれた場合に表示する1文。母数を考慮して候補生成時に確定させる。 */
  text: string
}

const MONTHLY_COMMENT_TEXT: Record<Exclude<MonthlyCommentMetricKey, 'nomination' | 'repeatRate'>, string> = {
  sales:      '今月は売上が伸びています。',
  avgSpend:   '今月は客単価が上がっています。',
  retail:     '今月はホームケア提案がお客様に届いています。',
}

/** 指名件数(件数そのもの・PHASE MYPAGE-COMMENT-TIERING)の段階別文言。 */
const NOMINATION_COMMENT_BY_TIER: Record<'low' | 'mid' | 'high', string> = {
  low:  '今月はご指名をいただき始めています。',
  mid:  '今月はご指名が増えています。',
  high: '今月はご指名が大きく増えています。',
}

/** リピート率diffの母数(今月の来店人数)の段階別文言。母数が少ないほど控えめな表現にする。 */
const REPEAT_COMMENT_BY_TIER: Record<'low' | 'mid' | 'high', string> = {
  low:  '今月は戻ってきてくださるお客様が少しずつ増えています。',
  mid:  '今月は戻ってきてくださるお客様が増えています。',
  high: '今月は戻ってきてくださるお客様が多く、しっかり関係を築けています。',
}

const MONTHLY_NO_PLUS_COMMENT = '今月も一人ひとり丁寧に向き合えています。'

/**
 * My Page「今月のひとこと」(PHASE MYPAGE-DEMO-CLEANUP、母数考慮はPHASE MYPAGE-COMMENT-TIERING)。
 *
 * 今月−先月の実データ(diff)のうちプラスで最も伸びた1指標を選び、その指標に対応する1文を
 * 返す。「先週のよかったところ」(週次diff)とは判定期間が異なる別ロジックとして両立させる
 * (ユーザー承認済み)。プラスが無ければ、架空の改善を作らず中立の1文を返す。
 * 指名・リピート率の2指標は、diffがプラスというだけで一律の強い表現を使うと母数が
 * 少ない場合に不自然(例: 指名2件でも「戻ってきてくださる方が多い」と言い切ってしまう)に
 * なるため、指名は指名件数(今月)、リピート率は算出根拠となる来店人数(今月・母数)の
 * 段階(1〜3/4〜9/10以上)に応じて文言の強さを変える。外舘の画面は既存方針どおり
 * 売上・客単価・店販を候補から除外する。
 */
function getMonthlyCommentCandidates(staffId: string | null, stats: MyStats): MonthlyCommentCandidate[] {
  const candidates: MonthlyCommentCandidate[] = []

  if (stats.nominationDiff > 0) {
    const tier = getCountTier(stats.nomination.thisMonth)
    candidates.push({
      key: 'nomination',
      diff: stats.nominationDiff,
      text: NOMINATION_COMMENT_BY_TIER[tier === 'none' ? 'low' : tier],
    })
  }
  if (stats.repeatRateDiff > 0) {
    const tier = getCountTier(stats.visitCount.thisMonth)
    candidates.push({
      key: 'repeatRate',
      diff: stats.repeatRateDiff,
      text: REPEAT_COMMENT_BY_TIER[tier === 'none' ? 'low' : tier],
    })
  }
  if (staffId !== SOTODATE_STAFF_ID) {
    if (stats.salesDiff > 0) {
      candidates.push({ key: 'sales', diff: stats.salesDiff, text: MONTHLY_COMMENT_TEXT.sales })
    }
    if (stats.avgSpendDiff !== null && stats.avgSpendDiff > 0) {
      candidates.push({ key: 'avgSpend', diff: stats.avgSpendDiff, text: MONTHLY_COMMENT_TEXT.avgSpend })
    }
    if (stats.retailSalesDiff !== null && stats.retailSalesDiff > 0) {
      candidates.push({ key: 'retail', diff: stats.retailSalesDiff, text: MONTHLY_COMMENT_TEXT.retail })
    }
  }
  return candidates
}

function buildMonthlyComment(staffId: string | null, stats: MyStats): string {
  const top = getMonthlyCommentCandidates(staffId, stats).sort((a, b) => b.diff - a.diff)[0]
  return top ? top.text : MONTHLY_NO_PLUS_COMMENT
}

// ─── そろそろの方タップ → Customer Bottom Sheet(PHASE MYPAGE-REPLENISH-TAP) ──────
//
// Phase1Screen.tsx(今日タブ)のhandleSelectCustomerFromNotification/
// toCustomerFromRow/toReservationFromRowと同じ変換(useCustomerStore→
// CustomerBottomSheet)をそのまま流用する。そろそろの方の通知(kind='homecare_replenish')
// は既にcustomerId/customerNameを持っているため、新規APIは追加しない。
function toCustomerFromRow(c: CustomerRow): BSCustomer {
  return {
    id:                    c.id,
    name:                  c.name,
    visits:                c.visitCount,
    visit_count:           c.visitCount,
    total_sales:           c.totalSpent,
    avg_price:             c.visitCount > 0 ? Math.round(c.totalSpent / c.visitCount) : 0,
    last_visit:            c.lastVisitDate ?? new Date(Date.now() - c.lastVisit * 86400000).toISOString().slice(0, 10),
    customer_type:         c.type,
    skinConcernType:       c.skinConcernType,
    vip_rank:              c.isVip ? 4 : 1,
    churn_risk:            c.churnRisk,
    line_response_rate:    c.lineResponseRate,
    next_visit_prediction: '',
    skin_tags:             [],
    recommended_cycle_days: undefined,
  }
}

function toReservationFromRow(c: CustomerRow): BSReservation {
  return {
    id:                    null,
    customer_id:           null,
    customer_hash_id:      null,
    staff_id:              c.assignedStaffId ?? '',
    menu:                  c.treatments[0] ?? '施術履歴未設定',
    scheduled_at:          new Date().toISOString(),
    status:                'confirmed',
    customer_name:         c.name,
    is_vip:                c.isVip,
    churn_risk:            c.churnRisk,
    days_since_last_visit: c.lastVisit,
    customer_type:         c.type,
  }
}

function SmallStat({ label, value, color = '#5C4033' }: { label: string; value: string; color?: string }) {
  return (
    <div
      className="flex-1 rounded-[16px] px-4 py-3 border border-[#F5E6E8]"
      style={{ background: '#FBF6F7', minHeight: '64px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
    >
      <p className="text-[10px]" style={{ color: '#9E8090' }}>{label}</p>
      <p className="text-[18px] font-bold tabular-nums mt-0.5" style={{ color, fontFamily: 'Inter, sans-serif' }}>{value}</p>
    </div>
  )
}

export default function MyStatsScreen() {
  const { stats, isLoading, error, notStaffAccount, fetchStats } = useMyStatsStore()
  const { initialized: authInitialized, session } = useAuthStore()
  const [showReservationsSheet, setShowReservationsSheet] = useState(false)
  const [showChangePassword, setShowChangePassword] = useState(false)

  // 今週予約サマリー(今日/明日)・「明日の担当」・「そろそろの方」用に既存ストアを
  // 再利用する(新規API・新規fetchロジックは追加しない)。
  const { reservations: todayReservations, isLoading: isHomeLoading, fetchTodayReservations } = useHomeStore()
  const { notifications, isLoading: isNotifLoading, error: notifError, fetchNotifications } = useNotificationsStore()

  // そろそろの方タップ → Customer Bottom Sheet(PHASE MYPAGE-REPLENISH-TAP)。
  // Phase1Screen.tsx(今日タブ)の通知タップと同じ遷移フロー(useNewCustomerSheetStore +
  // useCustomerStoreからの解決)を流用する。
  const {
    isOpen:      sheetOpen,
    customer:    sheetCustomer,
    reservation: sheetReservation,
    open:        openSheet,
    close:       closeSheet,
  } = useNewCustomerSheetStore()

  async function handleSelectCustomer(customerId: string) {
    let rows = useCustomerStore.getState().customers
    if (rows.length === 0) {
      await useCustomerStore.getState().fetchCustomers()
      rows = useCustomerStore.getState().customers
    }
    const row = rows.find((c) => c.id === customerId)
    if (row) openSheet(toCustomerFromRow(row), toReservationFromRow(row))
  }

  useEffect(() => {
    if (!authInitialized) return
    fetchStats()

    const uid = session?.user?.id ?? null
    const role = (
      (session?.user?.app_metadata?.role  as 'owner' | 'staff' | null) ??
      (session?.user?.user_metadata?.role as 'owner' | 'staff' | null) ??
      'staff'
    )
    if (uid) fetchTodayReservations(role, uid)
    fetchNotifications()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authInitialized, fetchStats])

  const tomorrowNotifications = notifications.filter(
    (n) => n.kind === 'visit_reminder' && n.title.startsWith('明日')
  )

  // ホームケア補充の頃(kind='homecare_replenish')。既存の通知検出ロジックをそのまま
  // 再利用するのみで、新しい判定ロジックは追加しない。
  const replenishNotifications = notifications.filter((n) => n.kind === 'homecare_replenish')

  const staffId = stats?.staffId ?? null
  const hero              = useMemo(() => getHeroContent(stats),          [stats])
  const nominationContent = useMemo(() => getNominationContent(staffId, stats),  [staffId, stats])
  const weeklyPraise       = useMemo(
    () => (stats ? buildWeeklyPraise(staffId, stats.weekly) : null),
    [staffId, stats]
  )

  // 今月の来店記録が無い場合、リピート率・指名率は算出根拠が無いため「データがまだ
  // ありません」を表示する(0%という嘘の数字を出さない)。指名件数(count モード)は
  // 0件自体が事実のため、この判定の対象外。
  const hasMonthlyVisitData = !!stats && stats.visitCount.thisMonth > 0

  const monthlyComment = useMemo(
    () => (stats ? buildMonthlyComment(staffId, stats) : null),
    [staffId, stats]
  )

  return (
    <div
      className="h-dvh flex flex-col overflow-hidden"
      style={{
        width: '100%',
        maxWidth: '430px',
        marginLeft: 'auto',
        marginRight: 'auto',
        background: 'linear-gradient(160deg, #F8F1F3 0%, #FDF7F8 50%, #F8EFF0 100%)',
        fontFamily: "'Inter', 'Noto Sans JP', sans-serif",
      }}
    >
      {/* ── ヘッダー ── */}
      <div
        className="flex-shrink-0 px-5"
        style={{
          paddingTop: 'max(52px, calc(env(safe-area-inset-top) + 12px))',
          paddingBottom: '16px',
          background: 'rgba(253,247,248,0.92)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderBottom: '1px solid #F5E6E8',
        }}
      >
        <p className="text-[10px] font-medium tracking-[0.32em] mb-0.5" style={{ color: '#C8A8B0' }}>
          SALON RIORA
        </p>
        <h1 className="text-[24px] font-light leading-tight" style={{ color: '#4A2C2A', fontFamily: 'Playfair Display, serif' }}>My Page</h1>
        <p className="text-[13px] mt-0.5" style={{ color: '#9E8090' }}>
          今週のご自身の実績とお客様情報です
        </p>
      </div>

      {/* ── コンテンツ ── */}
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden px-4 pt-4 no-scrollbar"
        style={{
          WebkitOverflowScrolling: 'touch',
          paddingBottom: 'calc(68px + max(12px, env(safe-area-inset-bottom)))',
        }}
      >
        {isLoading && (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i}
                className="bg-white rounded-[20px] border border-[#F5E6E8] h-[74px] animate-pulse"
                style={{ opacity: 1 - i * 0.1 }}
              />
            ))}
          </div>
        )}

        {!isLoading && stats && (
          <>
            {/* ── 0. 先月の実績(数字のみ・AIコメント無し) ── */}
            <div
              className="rounded-[20px] bg-white border border-[#F5E6E8] px-5 py-4 mb-4"
              style={{ boxShadow: '0 2px 12px rgba(245,160,181,0.08)' }}
            >
              <p className="text-[11px] font-semibold mb-2.5" style={{ color: '#9E8090' }}>先月の実績</p>
              <div className="flex gap-2.5 mb-2.5">
                <SmallStat label="売上" value={formatYen(stats.lastMonthSummary.sales)} />
                <SmallStat label="来店人数" value={`${stats.lastMonthSummary.visitCount}人`} />
                <SmallStat
                  label="客単価"
                  value={stats.lastMonthSummary.avgSpend !== null ? formatYen(stats.lastMonthSummary.avgSpend) : '—'}
                />
              </div>
              <div className="flex gap-2.5">
                <SmallStat
                  label="指名率"
                  value={stats.lastMonthSummary.nominationRate !== null ? `${stats.lastMonthSummary.nominationRate}%` : '—'}
                />
                <SmallStat
                  label="リピート率"
                  value={stats.lastMonthSummary.repeatRate !== null ? `${stats.lastMonthSummary.repeatRate}%` : '—'}
                />
                <SmallStat
                  label="店販売上"
                  value={formatYen(stats.lastMonthSummary.retailSales)}
                />
              </div>
            </div>

            {/* ── 1. 今週予約サマリー(今日・明日) ── */}
            <motion.button
              type="button"
              onClick={() => setShowReservationsSheet(true)}
              whileTap={{ scale: 0.98 }}
              className="w-full text-left mb-4"
            >
              <div className="flex items-center gap-1.5 mb-2 px-1">
                <CalendarDays size={13} style={{ color: '#D8A8B5' }} />
                <span className="text-[11px] font-semibold" style={{ color: '#9E8090' }}>今週の予約</span>
              </div>
              <div className="flex gap-2.5">
                <SmallStat
                  label="今日"
                  value={isHomeLoading ? '…' : `${todayReservations.length}件`}
                  color="#D14F86"
                />
                <SmallStat
                  label="明日"
                  value={isNotifLoading ? '…' : notifError ? '—' : `${tomorrowNotifications.length}件`}
                  color="#B98CC0"
                />
              </div>
            </motion.button>

            {/* ── 2. 主役カード(リピート率・絶対値・スタッフ別) ── */}
            <div
              className="rounded-[20px] bg-white border border-[#F5E6E8] px-5 py-4 mb-4"
              style={{ boxShadow: '0 2px 12px rgba(245,160,181,0.08)' }}
            >
              <p className="text-[11px] font-semibold mb-1" style={{ color: '#9E8090' }}>{hero.heading}</p>
              {hasMonthlyVisitData ? (
                <p className="text-[20px] font-bold tabular-nums" style={{ color: '#5C4033', fontFamily: 'Inter, sans-serif' }}>
                  <span className="text-[13px] font-semibold" style={{ color: '#9E8090' }}>リピート率 </span>
                  {stats.repeatRate.thisMonth}%
                </p>
              ) : (
                <p className="text-[13px]" style={{ color: '#C8A8B0' }}>今月のデータはまだありません</p>
              )}
              <p className="text-[12px] mt-1.5 leading-relaxed" style={{ color: '#9E8090' }}>{hero.subtext}</p>
            </div>

            {/* ── 3. 指名カード(スタッフ別) ── */}
            <div
              className="rounded-[20px] bg-white border border-[#F5E6E8] px-5 py-4 mb-4"
              style={{ boxShadow: '0 2px 12px rgba(245,160,181,0.08)' }}
            >
              <p className="text-[11px] font-semibold mb-1" style={{ color: '#9E8090' }}>
                {nominationContent.mode === 'rate' ? '指名率' : '今月のご指名'}
              </p>
              {nominationContent.mode === 'rate' ? (
                stats.nomination.rate !== null && stats.nomination.rate !== undefined ? (
                  <p className="text-[20px] font-bold tabular-nums" style={{ color: '#5C4033', fontFamily: 'Inter, sans-serif' }}>
                    {stats.nomination.rate}%
                  </p>
                ) : (
                  <p className="text-[13px]" style={{ color: '#C8A8B0' }}>今月のデータはまだありません</p>
                )
              ) : (
                <p className="text-[20px] font-bold tabular-nums" style={{ color: '#5C4033', fontFamily: 'Inter, sans-serif' }}>
                  {stats.nomination.thisMonth}件
                </p>
              )}
              {nominationContent.lines.length > 0 && (
                <div className="mt-2 pt-3" style={{ borderTop: '1px solid #F5E6E8' }}>
                  {nominationContent.lines.map((line) => (
                    <p key={line} className="text-[12.5px] leading-relaxed" style={{ color: '#5C4033' }}>{line}</p>
                  ))}
                </div>
              )}
            </div>

            {/* ── 先週のよかったところ ── */}
            {weeklyPraise && (
              <div
                className="rounded-[20px] bg-white border border-[#F5E6E8] px-5 py-4 mb-4"
                style={{ boxShadow: '0 2px 12px rgba(245,160,181,0.08)' }}
              >
                <p className="text-[11px] font-semibold mb-3" style={{ color: '#9E8090' }}>先週のよかったところ</p>

                {weeklyPraise.metric && (
                  <div className="flex items-center gap-2 mb-3">
                    <div
                      className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ background: 'rgba(82,200,122,0.14)' }}
                    >
                      <Check size={11} strokeWidth={3} style={{ color: '#52C87A' }} />
                    </div>
                    <span className="text-[13px]" style={{ color: '#5C4033' }}>
                      {weeklyPraise.metric.label} <span className="font-bold tabular-nums" style={{ fontFamily: 'Inter, sans-serif' }}>{weeklyPraise.metric.text}</span>
                    </span>
                  </div>
                )}

                <div
                  style={
                    weeklyPraise.metric
                      ? { borderTop: '1px solid #F5E6E8', paddingTop: '12px' }
                      : undefined
                  }
                >
                  {weeklyPraise.comments.map((line, i) => (
                    <p
                      key={line}
                      className="text-[12.5px] leading-relaxed"
                      style={{ color: '#5C4033', marginTop: i > 0 ? '4px' : undefined }}
                    >
                      {line}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {/* ── 4. 明日の担当のお客様(禁忌・重要メモ付き) ── */}
            <div className="mb-4">
              <div className="flex items-center gap-1.5 mb-2 px-1">
                <CalendarDays size={13} style={{ color: '#B98CC0' }} />
                <span className="text-[11px] font-semibold" style={{ color: '#9E8090' }}>明日の担当</span>
              </div>
              {isNotifLoading ? (
                <div className="bg-white rounded-[16px] border border-[#F5E6E8] h-[56px] animate-pulse" />
              ) : tomorrowNotifications.length === 0 ? (
                <div className="bg-white rounded-[16px] border border-[#F5E6E8] px-4 py-3.5">
                  <p className="text-[12.5px]" style={{ color: '#C8A8B0' }}>明日のご予約はありません</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {tomorrowNotifications.map((n) => {
                    const phrase = extractVisitPhrase(n.title)
                    return (
                      <div
                        key={n.id}
                        className="bg-white rounded-[16px] border border-[#F5E6E8] px-4 py-3"
                        style={{ boxShadow: '0 2px 10px rgba(245,160,181,0.06)' }}
                      >
                        <p className="text-[13px] font-semibold" style={{ color: '#5C4033' }}>
                          {n.customerName ?? '—'} 様
                        </p>
                        {phrase && (
                          <p className="text-[11px] mt-0.5 leading-snug" style={{ color: '#9E8090' }}>{phrase}</p>
                        )}
                        {n.detail && n.detail.length > 0 && (
                          <div className="mt-1.5 pt-1.5" style={{ borderTop: '1px solid #F5E6E8' }}>
                            {n.detail.map((d) => (
                              <p key={d} className="text-[11px] leading-snug mt-0.5" style={{ color: '#9E8090' }}>{d}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* ── 5. そろそろの方(ホームケア補充) ── */}
            <div className="mb-4">
              <div className="flex items-center gap-1.5 mb-2 px-1">
                <Clock size={13} style={{ color: '#D8A8B5' }} />
                <span className="text-[11px] font-semibold" style={{ color: '#9E8090' }}>そろそろの方</span>
              </div>
              {isNotifLoading ? (
                <div className="bg-white rounded-[16px] border border-[#F5E6E8] h-[56px] animate-pulse" />
              ) : replenishNotifications.length === 0 ? (
                <div className="bg-white rounded-[16px] border border-[#F5E6E8] px-4 py-3.5">
                  <p className="text-[12.5px]" style={{ color: '#C8A8B0' }}>現在、対象のお客様はいません</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {replenishNotifications.map((n) => {
                    const detailText = n.customerName ? n.title.replace(`${n.customerName}様 `, '') : n.title
                    return (
                      <div
                        key={n.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => { if (n.customerId) handleSelectCustomer(n.customerId) }}
                        onKeyDown={(e) => { if (e.key === 'Enter' && n.customerId) handleSelectCustomer(n.customerId) }}
                        className="bg-white rounded-[16px] border border-[#F5E6E8] px-4 py-3"
                        style={{ boxShadow: '0 2px 10px rgba(245,160,181,0.06)', cursor: n.customerId ? 'pointer' : undefined }}
                      >
                        <p className="text-[13px] font-semibold" style={{ color: '#5C4033' }}>
                          {n.customerName ?? '—'} 様
                        </p>
                        <p className="text-[11px] mt-0.5 leading-snug" style={{ color: '#9E8090' }}>{detailText}</p>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* ── 6. 今月のひとこと(実データ駆動) ── */}
            {monthlyComment && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="rounded-[20px] p-4 mt-1 mb-4"
                style={{ background: 'linear-gradient(160deg, #FFF3F6, #FBF6FF)', border: '1px solid #F0DCE4' }}
              >
                <div className="flex items-center gap-1.5 mb-2.5">
                  <Sparkles size={14} style={{ color: '#D98292' }} />
                  <span className="text-[12px] font-bold" style={{ color: '#5C4033' }}>今月のひとこと</span>
                </div>

                <p className="text-[13px] leading-relaxed" style={{ color: '#5C4033' }}>{monthlyComment}</p>
              </motion.div>
            )}
          </>
        )}

        {!isLoading && notStaffAccount && (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-center px-6">
            <p className="text-[13px]" style={{ color: '#9E8090' }}>
              スタッフアカウントでログインしてください
            </p>
            <p className="text-[11px]" style={{ color: '#C8A8B0' }}>
              管理者アカウントではMy Pageの実績を表示できません
            </p>
          </div>
        )}

        {!isLoading && !stats && !notStaffAccount && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-6">
            <p className="text-[13px]" style={{ color: '#9E8090' }}>
              データの取得に失敗しました
            </p>
            {error && <p className="text-[11px]" style={{ color: '#C8A8B0' }}>{error}</p>}
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={() => fetchStats()}
              className="flex items-center gap-1.5 text-[12px] font-semibold px-4 py-2 rounded-full"
              style={{ color: '#D98292', border: '1px solid #D98292', background: '#fff' }}
            >
              <RefreshCw size={12} /> 再読み込み
            </motion.button>
          </div>
        )}

        {/* ── アカウント(パスワード変更・スタッフ/管理者共通で常時表示) ── */}
        {!isLoading && (
          <div className="mt-2">
            <p className="text-[10px] tracking-[0.2em] font-medium mb-2 px-1" style={{ color: '#C8B0B8' }}>
              ACCOUNT
            </p>
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={() => setShowChangePassword(true)}
              className="w-full flex items-center gap-3 rounded-2xl p-4"
              style={{ background: '#FFFFFF', border: '1px solid #F5E6E8', boxShadow: '0 2px 10px rgba(245,160,181,0.08)' }}
            >
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(217,130,146,0.10)' }}>
                <Lock size={18} style={{ color: '#D98292' }} strokeWidth={1.8} />
              </div>
              <span className="text-[13px] font-medium text-left" style={{ color: '#5C4033' }}>
                パスワード変更
              </span>
            </motion.button>
          </div>
        )}
      </div>

      <AppBottomNav />

      <MyPageReservationsSheet
        isOpen={showReservationsSheet}
        onClose={() => setShowReservationsSheet(false)}
        todayReservations={todayReservations}
        tomorrowNotifications={tomorrowNotifications}
      />

      <ChangePasswordSheet
        isOpen={showChangePassword}
        onClose={() => setShowChangePassword(false)}
      />

      {sheetOpen && sheetCustomer && sheetReservation && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 60 }}>
          <CustomerBottomSheet
            customer={sheetCustomer}
            reservation={sheetReservation}
            onClose={closeSheet}
          />
        </div>
      )}
    </div>
  )
}
