'use client'
/**
 * TodayBriefingSummaryCard — 今日タブ最上部「今日のブリーフィング」
 * (PHASE STAFF-NOTIFICATION-AI・STAFF-NOTIFICATION-AI-2・STAFF-NOTIFICATION-TAP-1)
 *
 * 出勤直後30秒で今日の接客準備ができるよう、今日の予約全体+担当顧客ロスターから
 * 件数サマリーをルールベースで組み立てて表示する。LLMは一切使用しない
 * (テンプレート＋条件分岐のみ)。データは GET /api/today-briefing の summary/
 * notificationTargets フィールド(既存エンドポイントの拡張。新規API・新規テーブルは
 * 追加していない)。
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
 * PHASE STAFF-NOTIFICATION-TAP-1(2026-08-01・ユーザー指示): 顧客に紐づく通知
 * (①②③④⑤⑥のうち視覚アイコン付きの1行=各summaryCountに対応する行)をタップ可能にし、
 * 対象1名なら直接onSelectCustomerでCustomer Bottom Sheetを開く。2名以上なら
 * BriefingTargetsSheet(対象顧客一覧・既存NotificationSheetと同じボトムシート
 * デザイン)を開き、そこから1名選ぶとCustomer Bottom Sheetを開く。新しいページは
 * 作らず、このカード内で完結させている。
 *
 * データ取得は行わない(このコンポーネント単体では fetchTodayBriefing() を呼ばない)。
 * 常に隣接する TodayBriefingCard が同じ useTodayBriefingStore を使ってマウント時に
 * 取得するため、二重フェッチを避けるためここでは購読のみに留める。
 */
import { useState } from 'react'
import { useTodayBriefingStore } from '@/store/useTodayBriefingStore'
import { C } from './TodayBriefingCard'
import BriefingTargetsSheet from './BriefingTargetsSheet'
import type { TodayBriefingNotificationTarget } from '@/types/todayBriefing'

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

interface BriefingLine {
  key:      string
  text:     string
  /** このタイトルはBriefingTargetsSheet(対象2名以上)のヘッダーに使う。 */
  title:    string
  targets:  TodayBriefingNotificationTarget[]
}

interface Props {
  /** 通知タップ→Customer Bottom Sheet遷移(PHASE STAFF-NOTIFICATION-TAP-1)。
   *  未指定なら行はタップ不可(静的テキストのまま)。 */
  onSelectCustomer?: (customerId: string) => void
}

export default function TodayBriefingSummaryCard({ onSelectCustomer }: Props) {
  const { briefing, isLoading } = useTodayBriefingStore()
  const [activeSheet, setActiveSheet] = useState<BriefingLine | null>(null)

  if (isLoading && !briefing) {
    return (
      <div className="mx-4 mt-3 rounded-2xl h-[120px] animate-pulse" style={{ background: C.soft }} />
    )
  }

  if (!briefing) return null

  const { summary, notificationTargets: nt } = briefing

  // 生成ルール(テンプレート＋条件分岐のみ・ランダム要素なし):
  //   来店人数は常に1行目(予約0件なら「今日は予約がありません」)。タップ不可。
  //   それ以外は該当人数が1名以上の場合のみ、優先順位①〜⑥の順で行を追加する
  //   (該当が無い項目の行自体を作らない=非表示)。再来推奨/来店45日/店販60日は
  //   今日の予約の有無と無関係な担当顧客ロスター起点のデータのため、予約0件の日でも
  //   該当があれば表示する(「今日やるべきこと」が予約の有無だけで消えないようにするため)。
  const lines: BriefingLine[] = []
  // ① 禁忌
  if (summary.contraindicationCount > 0) {
    lines.push({
      key: 'contraindication', title: '禁忌事項のお客様',
      text: `禁忌事項のお客様が${summary.contraindicationCount}名います → ${NEXT_ACTION.contraindication}`,
      targets: nt.contraindication,
    })
  }
  // ② 初回来店
  if (summary.firstVisitCount > 0) {
    lines.push({
      key: 'firstVisit', title: '初回来店のお客様',
      text: `初回来店のお客様が${summary.firstVisitCount}名います → ${NEXT_ACTION.firstVisit}`,
      targets: nt.firstVisit,
    })
  }
  // ③ 重要な申し送り
  if (summary.importantMemoCount > 0) {
    lines.push({
      key: 'importantMemo', title: '重要な申し送りがあるお客様',
      text: `重要な申し送りがあるお客様が${summary.importantMemoCount}名います → ${NEXT_ACTION.importantMemo}`,
      targets: nt.importantMemo,
    })
  }
  // ④ 再来推奨
  if (summary.recommendedRevisitCount > 0) {
    lines.push({
      key: 'recommendedRevisit', title: '再来推奨日を過ぎたお客様',
      text: `再来推奨日を過ぎたお客様が${summary.recommendedRevisitCount}名います → ${NEXT_ACTION.recommendedRevisit}`,
      targets: nt.recommendedRevisit,
    })
  }
  if (summary.staleVisitCount > 0) {
    lines.push({
      key: 'staleVisit', title: '前回来店から45日以上のお客様',
      text: `前回来店から45日以上のお客様が${summary.staleVisitCount}名います → ${NEXT_ACTION.staleVisit}`,
      targets: nt.staleVisit,
    })
  }
  // ⑤ ホームケア
  if (summary.homecareCount > 0) {
    lines.push({
      key: 'homecare', title: 'ホームケアをご案内できそうなお客様',
      text: `ホームケアをご案内できそうなお客様が${summary.homecareCount}名います → ${NEXT_ACTION.homecare}`,
      targets: nt.homecare,
    })
  }
  if (summary.retailReplenishCount > 0) {
    lines.push({
      key: 'retailReplenish', title: '店販ご購入のお客様',
      text: `店販商品のご購入から日にちが経っているお客様が${summary.retailReplenishCount}名います → ${NEXT_ACTION.retailReplenish}`,
      targets: nt.retailReplenish,
    })
  }
  // ⑥ 誕生日
  if (summary.birthdayCount > 0) {
    lines.push({
      key: 'birthday', title: 'お誕生日のお客様',
      text: `お誕生日のお客様が${summary.birthdayCount}名います → ${NEXT_ACTION.birthday}`,
      targets: nt.birthday,
    })
  }

  const visitCountLabel = summary.visitCount === 0 ? '今日は予約がありません' : `本日は${summary.visitCount}名ご来店です`

  function handleLineTap(line: BriefingLine) {
    if (!onSelectCustomer || line.targets.length === 0) return
    if (line.targets.length === 1) {
      onSelectCustomer(line.targets[0].id)
      return
    }
    setActiveSheet(line)
  }

  return (
    <>
      <div
        className="mx-4 mt-3 rounded-2xl p-4"
        style={{ background: C.card, border: `1px solid ${C.line}`, boxShadow: '0 8px 30px rgba(92,64,51,0.08)' }}
      >
        <div className="rounded-[14px] px-4 py-3.5" style={{ background: C.brief }}>
          <p className="text-[10px] tracking-[0.1em] mb-2.5" style={{ color: C.note, fontFamily: 'Inter, sans-serif' }}>
            今日のブリーフィング
          </p>

          {/* 来店人数は常に先頭・タップ不可(特定の顧客に紐づく通知ではないため) */}
          <div className="flex items-start gap-2.5 py-1.5 text-[14px]">
            <span className="w-5 text-center flex-shrink-0" style={{ color: C.ink }}>・</span>
            <span style={{ color: C.ink }}>{visitCountLabel}</span>
          </div>

          {lines.map((line) => (
            <button
              key={line.key}
              type="button"
              onClick={() => handleLineTap(line)}
              disabled={!onSelectCustomer}
              className="w-full flex items-start gap-2.5 py-1.5 text-[14px] text-left"
              style={{ cursor: onSelectCustomer ? 'pointer' : 'default' }}
            >
              <span className="w-5 text-center flex-shrink-0" style={{ color: C.ink }}>・</span>
              <span style={{ color: C.ink, textDecoration: onSelectCustomer ? 'underline' : 'none', textDecorationColor: C.line }}>
                {line.text}
              </span>
            </button>
          ))}
        </div>
      </div>

      <BriefingTargetsSheet
        isOpen={!!activeSheet}
        title={activeSheet?.title ?? ''}
        targets={activeSheet?.targets ?? []}
        onClose={() => setActiveSheet(null)}
        onSelectCustomer={(customerId) => onSelectCustomer?.(customerId)}
      />
    </>
  )
}
