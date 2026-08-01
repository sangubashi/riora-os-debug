'use client'
/**
 * TodayBriefingSummaryCard — 今日タブ最上部「今日のブリーフィング」
 * (PHASE STAFF-NOTIFICATION-AI・STAFF-NOTIFICATION-AI-2)
 *
 * 出勤直後30秒で今日の接客準備ができるよう、今日の予約全体+担当顧客ロスターから
 * 件数サマリーをルールベースで組み立てて表示する。LLMは一切使用しない
 * (テンプレート＋条件分岐のみ)。データは GET /api/today-briefing の summary フィールド
 * (既存エンドポイントの拡張。新規API・新規テーブルは追加していない)。
 *
 * UIはTodayBriefingCard.tsx(同じ今日タブ最上部・直下に並ぶ既存カード)のカード枠
 * (mx-4 mt-3 rounded-2xl p-4・白背景・border・shadow)と「今日、気をつけること」ボックス
 * (rounded-[14px]・背景C.brief・ラベルtracking)をそのまま再利用する。色・角丸・shadow・
 * padding・fontは一切変更していない。新しいカードは追加していない。
 *
 * 表示優先順位(危険系優先・ユーザー指示2026-08-01):
 *   ①禁忌 → ②初回来店 → ③重要な申し送り → ④再来推奨日超過/来店45日以上 →
 *   ⑤ホームケア/店販60日以上 → ⑥誕生日
 * ④⑤はそれぞれ2種類の通知が同じ優先度を共有するため、行としては2行に分けて
 * 連続表示する(1行に丸めない。件数の意味が異なるため)。
 *
 * データ取得は行わない(このコンポーネント単体では fetchTodayBriefing() を呼ばない)。
 * 常に隣接する TodayBriefingCard が同じ useTodayBriefingStore を使ってマウント時に
 * 取得するため、二重フェッチを避けるためここでは購読のみに留める。
 */
import { useTodayBriefingStore } from '@/store/useTodayBriefingStore'
import { C } from './TodayBriefingCard'

// PHASE STAFF-NOTIFICATION-AI/-2: 項目ごとの固定アクション文言。
// AI文章生成は行わず、項目種別→固定テンプレートの単純な対応表のみ(条件分岐なし)。
const NEXT_ACTION = {
  contraindication:  '施術前にカルテをご確認ください',
  firstVisit:        '最初の5分を丁寧に',
  importantMemo:     '施術前に一度ご確認ください',
  recommendedRevisit: '次回のご来店をご案内しましょう',
  staleVisit:        '来店状況を確認してみましょう',
  homecare:          'ご使用状況を確認してみましょう',
  retailReplenish:   'ホームケアの確認をおすすめします',
  birthday:          'お祝いの一言を添えましょう',
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
  //   来店人数は常に1行目(予約0件なら「今日は予約がありません」)。
  //   それ以外は該当人数が1名以上の場合のみ、優先順位①〜⑥の順で行を追加する
  //   (該当が無い項目の行自体を作らない=非表示)。再来推奨/来店45日/店販60日は
  //   今日の予約の有無と無関係な担当顧客ロスター起点のデータのため、予約0件の日でも
  //   該当があれば表示する(「今日やるべきこと」が予約の有無だけで消えないようにするため)。
  const lines: string[] = []
  if (summary.visitCount === 0) {
    lines.push('今日は予約がありません')
  } else {
    lines.push(`本日は${summary.visitCount}名ご来店です`)
  }
  // ① 禁忌
  if (summary.contraindicationCount > 0) {
    lines.push(`禁忌事項のお客様が${summary.contraindicationCount}名います → ${NEXT_ACTION.contraindication}`)
  }
  // ② 初回来店
  if (summary.firstVisitCount > 0) {
    lines.push(`初回来店のお客様が${summary.firstVisitCount}名います → ${NEXT_ACTION.firstVisit}`)
  }
  // ③ 重要な申し送り
  if (summary.importantMemoCount > 0) {
    lines.push(`重要な申し送りがあるお客様が${summary.importantMemoCount}名います → ${NEXT_ACTION.importantMemo}`)
  }
  // ④ 再来推奨
  if (summary.recommendedRevisitCount > 0) {
    lines.push(`再来推奨日を過ぎたお客様が${summary.recommendedRevisitCount}名います → ${NEXT_ACTION.recommendedRevisit}`)
  }
  if (summary.staleVisitCount > 0) {
    lines.push(`前回来店から45日以上のお客様が${summary.staleVisitCount}名います → ${NEXT_ACTION.staleVisit}`)
  }
  // ⑤ ホームケア
  if (summary.homecareCount > 0) {
    lines.push(`ホームケアをご案内できそうなお客様が${summary.homecareCount}名います → ${NEXT_ACTION.homecare}`)
  }
  if (summary.retailReplenishCount > 0) {
    lines.push(`店販商品のご購入から日にちが経っているお客様が${summary.retailReplenishCount}名います → ${NEXT_ACTION.retailReplenish}`)
  }
  // ⑥ 誕生日
  if (summary.birthdayCount > 0) {
    lines.push(`お誕生日のお客様が${summary.birthdayCount}名います → ${NEXT_ACTION.birthday}`)
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
