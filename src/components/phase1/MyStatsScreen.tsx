'use client'
/**
 * MyStatsScreen — 「わたし」タブ（v1最小版）
 *
 * 他人比較・ランキングは一切行わない。表示は自分の先月比のみ。
 * (Riora OS v1.0 再設計書 準拠)
 *
 * PHASE MYPAGE-UX-1(2026-07-27・UI改善のみ): 今週予約サマリー(今日/明日)・
 * AIコメント(今月の強み/改善ポイント)を追加、カードの高さ統一、空状態メッセージ改善。
 * 追加データはすべて既存API/既存ストアの再利用のみ(useHomeStore=GET /api/home/reservations、
 * useNotificationsStore=GET /api/notifications)で、新規API・新規分析ロジックは一切追加していない。
 * 「今週残り(明後日以降)」はスタッフ本人に絞って取得できる既存データソースが無いため、
 * ユーザー承認のうえ今回は対象外(今日・明日のみ)としている。
 */
import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { TrendingUp, TrendingDown, Minus, CalendarDays, Sparkles, RefreshCw } from 'lucide-react'
import AppBottomNav from './AppBottomNav'
import MyStatsDetailSheet from './MyStatsDetailSheet'
import { useMyStatsStore, type MetricDetail } from '@/store/useMyStatsStore'
import { useHomeStore } from '@/store/useHomeStore'
import { useNotificationsStore } from '@/store/useNotificationsStore'
import { useAuthStore } from '@/store/useAuthStore'

function formatDiff(value: number, unit: string): string {
  const isZero = value === 0
  const isUp   = value > 0
  const sign   = isZero ? '' : isUp ? '+' : ''
  return `${sign}${value}${unit}`
}

function formatYenDiff(value: number): string {
  const isZero = value === 0
  const isUp   = value > 0
  const sign   = isZero ? '' : isUp ? '+' : '-'
  return `${sign}¥${Math.abs(value).toLocaleString('ja-JP')}`
}

function DiffValue({ value, text }: { value: number; text: string }) {
  const isZero = value === 0
  const isUp   = value > 0
  // 下降は責めない表示にする(赤ではなく既存の控えめグレー#9E8090を流用)。
  const color  = isUp ? '#52C87A' : '#9E8090'
  const Icon   = isZero ? Minus : isUp ? TrendingUp : TrendingDown
  return (
    <div className="flex items-center gap-1" style={{ color }}>
      <Icon size={14} strokeWidth={2.5} />
      <span className="text-[20px] font-bold tabular-nums" style={{ fontFamily: 'Inter, sans-serif' }}>
        {text}
      </span>
    </div>
  )
}

/**
 * My Page AIコメント(PHASE MYPAGE-UX-2・2026-07-27)。
 *
 * 目的は「スタッフを評価する」ではなく「スタッフを応援する」こと(ユーザー指示)。
 * 特定の指標のdiff値には一切連動させず、固定テンプレート(良い点20種・応援20種)から
 * 毎回ランダムに選ぶだけの表示ロジック。LLM不使用、新しい集計・スコアリングは行わない
 * (数値は他の先月比カードに事実として既に表示されているため、ここでは繰り返さない)。
 *
 * NG表現(ユーザー指示): 「あと◯件」「あと◯%」「目標まで」「達成まで」「ノルマ」
 * 「頑張って」「もっと」「不足しています」「悪いです」等、数字で追い込む表現・評価的な
 * 表現は全テンプレートに含めていない。
 *
 * 表示ルール: 良い点コメントは毎回必ず1つ表示。応援コメントは約20%の確率でのみ
 * 追加表示し、応援コメント単独では絶対に表示しない(必ず良い点とセット)。
 */
const STRENGTH_COMMENTS: readonly string[] = [
  '丁寧な対応が習慣になってきています。',
  'お客様に安心感を与える接客ができています。',
  '落ち着いた雰囲気で接客できていますね。',
  '信頼感のある接客ができています。',
  'お客様との信頼関係が育っています。',
  '良い流れがしっかり定着してきています。',
  '今月も安定した接客が続いています。',
  '無理のない自然な接客が続いています。',
  '一人ひとりに寄り添った接客ができています。',
  '日々の積み重ねが形になっています。',
  '丁寧な言葉づかいがお客様に伝わっています。',
  'お客様が話しやすい雰囲気を作れています。',
  '落ち着いた対応が安心感につながっています。',
  '一貫した接客スタイルができあがってきています。',
  'お客様目線を大切にした接客ができています。',
  '穏やかな空気感で接客できています。',
  '細やかな気配りが行き届いています。',
  'お客様との会話を大切にできています。',
  '丁寧なカウンセリングが続いています。',
  'じっくりと向き合う接客ができています。',
] as const

const CHEER_COMMENTS: readonly string[] = [
  '次回もホームケアの話題を少しだけ触れてみましょう。',
  '会話の流れの中で自然にご提案してみましょう。',
  '無理のない範囲で続けていきましょう。',
  'お客様の反応を見ながら提案を重ねてみましょう。',
  '焦らず、お客様のペースを大切にしていきましょう。',
  '今の良い流れをそのまま続けていきましょう。',
  '次回もいつも通りの丁寧な接客を心がけましょう。',
  'お客様のペースに合わせて、ゆっくり進めていきましょう。',
  '次のご来店でも、自然な会話を楽しんでみましょう。',
  '小さな気づきを大切に、次回につなげていきましょう。',
  '今の雰囲気を大事に、次回も接客してみましょう。',
  '次回は少しだけ会話の幅を広げてみましょう。',
  'お客様の様子を見ながら、無理なく提案してみましょう。',
  '次のご来店も、いつものペースで大丈夫です。',
  'ゆったりとした気持ちで次回も接客してみましょう。',
  '次回も、お客様に寄り添う気持ちを大切にしましょう。',
  '今のスタイルを大切に、次回も続けていきましょう。',
  '次のご来店では、少し会話を増やしてみましょう。',
  'お客様との時間を大切に、次回も過ごしてみましょう。',
  '焦らず、次回も一つひとつ丁寧に進めていきましょう。',
] as const

/** 応援コメントを追加表示する確率(約20%・ユーザー指示)。 */
const CHEER_SHOW_RATE = 0.2

// 直前に表示した文章と同じものを連続表示しないための記憶(ブラウザのlocalStorageのみ・
// DB保存なし)。40種類あれば「前回と違うものを選ぶだけ」で十分というユーザー指示のため、
// 2回前以前の履歴は持たない(直前の1件のみ除外する)。
const LAST_STRENGTH_KEY = 'riora_mypage_last_strength_comment'
const LAST_CHEER_KEY    = 'riora_mypage_last_cheer_comment'

function readLastShown(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    // プライベートブラウズ等でlocalStorageが使えない場合は、連続回避なしの通常ランダムに
    // フォールバックする(機能停止させない)。
    return null
  }
}

function writeLastShown(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // 保存できなくても表示自体は続行する。
  }
}

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

/** 直前に表示した1件を候補から除いてランダムに選ぶ(それ以外は完全ランダムのまま)。 */
function pickRandomExcludingLast(arr: readonly string[], lastShown: string | null): string {
  const candidates = lastShown === null ? arr : arr.filter((text) => text !== lastShown)
  return pickRandom(candidates.length > 0 ? candidates : arr)
}

function buildAiComments(): { strength: string; cheer: string | null } {
  const strength = pickRandomExcludingLast(STRENGTH_COMMENTS, readLastShown(LAST_STRENGTH_KEY))
  writeLastShown(LAST_STRENGTH_KEY, strength)

  let cheer: string | null = null
  if (Math.random() < CHEER_SHOW_RATE) {
    cheer = pickRandomExcludingLast(CHEER_COMMENTS, readLastShown(LAST_CHEER_KEY))
    writeLastShown(LAST_CHEER_KEY, cheer)
  }

  return { strength, cheer }
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
  const [selected, setSelected] = useState<{ title: string; unit: '件' | '%' | '円'; detail: MetricDetail | null } | null>(null)

  // 今週予約サマリー(今日/明日)用に既存ストアを再利用する(新規API・新規fetchロジックは追加しない)。
  const { reservations: todayReservations, isLoading: isHomeLoading, fetchTodayReservations } = useHomeStore()
  const { notifications, isLoading: isNotifLoading, error: notifError, fetchNotifications } = useNotificationsStore()

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

  const tomorrowReservationCount = notifications.filter(
    (n) => n.kind === 'visit_reminder' && n.title.startsWith('明日')
  ).length

  const cards = stats ? [
    {
      label: '先月比 指名',
      node: <DiffValue value={stats.nominationDiff} text={formatDiff(stats.nominationDiff, '件')} />,
      onTap: () => setSelected({ title: '指名', unit: '件', detail: stats.nomination }),
    },
    {
      label: '先月比 リピート率',
      node: <DiffValue value={stats.repeatRateDiff} text={formatDiff(stats.repeatRateDiff, '%')} />,
      onTap: () => setSelected({ title: 'リピート率', unit: '%', detail: stats.repeatRate }),
    },
    {
      label: '先月比 店販売上',
      node: stats.retailSalesDiff === null
        ? <span className="text-[13px]" style={{ color: '#C8A8B0' }}>来店データがまだありません</span>
        : <DiffValue value={stats.retailSalesDiff} text={formatYenDiff(stats.retailSalesDiff)} />,
      onTap: () => setSelected({ title: '店販売上', unit: '円', detail: stats.retailSales }),
    },
    {
      label: '来店数差分',
      node: <DiffValue value={stats.visitCountDiff} text={formatDiff(stats.visitCountDiff, '件')} />,
      onTap: () => setSelected({ title: '来店数', unit: '件', detail: stats.visitCount }),
    },
  ] : []

  // stats参照が変わる(=再取得された)たびに選び直す。同一セッション中の再描画では
  // 選び直さない(毎回チラつかないよう安定させる)。
  const aiComments = useMemo(() => (stats ? buildAiComments() : null), [stats])

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
          先月と比べたご自身の実績です
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
            {/* ── 今週予約サマリー(今日・明日) ── */}
            <div className="mb-4">
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
                  value={isNotifLoading ? '…' : notifError ? '—' : `${tomorrowReservationCount}件`}
                  color="#B98CC0"
                />
              </div>
            </div>

            {/* ── 先月比カード ── */}
            {cards.map((card, i) => (
              <motion.button
                key={card.label}
                type="button"
                onClick={card.onTap}
                whileTap={{ scale: 0.98 }}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="w-full text-left bg-white rounded-[20px] border border-[#F5E6E8] flex items-center justify-between px-5 py-4 mb-3"
                style={{ boxShadow: '0 2px 12px rgba(245,160,181,0.08)', minHeight: '68px' }}
              >
                <span className="text-[13px] font-medium" style={{ color: '#5C4033' }}>
                  {card.label}
                </span>
                {card.node}
              </motion.button>
            ))}

            {/* ── AIコメント(応援メッセージ) ── */}
            {aiComments && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="rounded-[20px] p-4 mt-1"
                style={{ background: 'linear-gradient(160deg, #FFF3F6, #FBF6FF)', border: '1px solid #F0DCE4' }}
              >
                <div className="flex items-center gap-1.5 mb-2.5">
                  <Sparkles size={14} style={{ color: '#D98292' }} />
                  <span className="text-[12px] font-bold" style={{ color: '#5C4033' }}>今月のひとこと</span>
                </div>

                <p className="text-[13px] leading-relaxed" style={{ color: '#5C4033' }}>{aiComments.strength}</p>

                {aiComments.cheer && (
                  <p className="text-[12.5px] leading-relaxed mt-2" style={{ color: '#9F7E6C' }}>{aiComments.cheer}</p>
                )}
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
      </div>

      <AppBottomNav />

      <MyStatsDetailSheet
        isOpen={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.title ?? ''}
        unit={selected?.unit ?? '件'}
        detail={selected?.detail ?? null}
      />
    </div>
  )
}
