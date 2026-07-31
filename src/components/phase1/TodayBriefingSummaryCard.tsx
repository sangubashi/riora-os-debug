'use client'
/**
 * TodayBriefingSummaryCard — 今日タブ最上部「今日のブリーフィング」(PHASE STAFF-NOTIFICATION-AI)
 *
 * 出勤直後30秒で今日の接客準備ができるよう、今日の予約全体から件数サマリーを
 * ルールベースで組み立てて表示する。LLMは一切使用しない(テンプレート＋条件分岐のみ)。
 * データは GET /api/today-briefing の summary フィールド(既存エンドポイントの拡張。
 * 新規API・新規テーブルは追加していない)。
 *
 * UIはTodayBriefingCard.tsx(同じ今日タブ最上部・直下に並ぶ既存カード)のカード枠
 * (mx-4 mt-3 rounded-2xl p-4・白背景・border・shadow)と「今日、気をつけること」ボックス
 * (rounded-[14px]・背景C.brief・ラベルtracking)をそのまま再利用する。色・角丸・shadow・
 * padding・fontは一切変更していない。
 *
 * データ取得は行わない(このコンポーネント単体では fetchTodayBriefing() を呼ばない)。
 * 常に隣接する TodayBriefingCard が同じ useTodayBriefingStore を使ってマウント時に
 * 取得するため、二重フェッチを避けるためここでは購読のみに留める。
 */
import { useTodayBriefingStore } from '@/store/useTodayBriefingStore'
import { C } from './TodayBriefingCard'

// PHASE STAFF-NOTIFICATION-AI(次の一手追加): 項目ごとの固定アクション文言。
// AI文章生成は行わず、項目種別→固定テンプレートの単純な対応表のみ(条件分岐なし・
// 常にこの5種のいずれか)。ユーザー指定の例文をそのまま採用。
const NEXT_ACTION = {
  firstVisit:        '最初の5分を丁寧に',
  contraindication:  '施術前にカルテをご確認ください',
  homecare:          'ご使用状況を確認してみましょう',
  birthday:          'お祝いの一言を添えましょう',
  importantMemo:     '施術前に一度ご確認ください',
} as const

export default function TodayBriefingSummaryCard() {
  const { briefing, isLoading } = useTodayBriefingStore()

  if (isLoading && !briefing) {
    return (
      <div className="mx-4 mt-3 rounded-2xl h-[120px] animate-pulse" style={{ background: C.soft }} />
    )
  }

  if (!briefing) return null

  const { summary } = briefing

  // 生成ルール(テンプレート＋条件分岐のみ・ランダム要素なし):
  //   予約0件 → 「今日は予約がありません」のみ表示し、以降の行は組み立てない。
  //   予約1件以上 → 来店人数は常に表示。それ以外は該当人数が1名以上の場合のみ追加する
  //   (該当が無い項目の行自体を作らない=非表示)。
  const lines: string[] = []
  if (summary.visitCount === 0) {
    lines.push('今日は予約がありません')
  } else {
    lines.push(`本日は${summary.visitCount}名ご来店です`)
    if (summary.firstVisitCount > 0) {
      lines.push(`初回来店のお客様が${summary.firstVisitCount}名います → ${NEXT_ACTION.firstVisit}`)
    }
    if (summary.contraindicationCount > 0) {
      lines.push(`禁忌事項のお客様が${summary.contraindicationCount}名います → ${NEXT_ACTION.contraindication}`)
    }
    if (summary.homecareCount > 0) {
      lines.push(`ホームケアをご案内できそうなお客様が${summary.homecareCount}名います → ${NEXT_ACTION.homecare}`)
    }
    if (summary.birthdayCount > 0) {
      lines.push(`お誕生日のお客様が${summary.birthdayCount}名います → ${NEXT_ACTION.birthday}`)
    }
    if (summary.importantMemoCount > 0) {
      lines.push(`重要な申し送りがあるお客様が${summary.importantMemoCount}名います → ${NEXT_ACTION.importantMemo}`)
    }
  }

  return (
    <div
      className="mx-4 mt-3 rounded-2xl p-4"
      style={{ background: C.card, border: `1px solid ${C.line}`, boxShadow: '0 8px 30px rgba(92,64,51,0.08)' }}
    >
      <div className="rounded-[14px] px-4 py-3.5" style={{ background: C.brief }}>
        <p className="text-[10px] tracking-[0.1em] mb-2.5" style={{ color: C.note, fontFamily: 'Inter, sans-serif' }}>
          今日のブリーフィング
        </p>
        {lines.map((line) => (
          <div key={line} className="flex items-start gap-2.5 py-1.5 text-[14px]">
            <span className="w-5 text-center flex-shrink-0" style={{ color: C.ink }}>・</span>
            <span style={{ color: C.ink }}>{line}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
