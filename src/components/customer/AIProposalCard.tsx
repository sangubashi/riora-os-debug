'use client'
/**
 * AIProposalCard.tsx
 * CustomerBottomSheet 内「✨ 今日の接客ポイント」カード本体。
 * STAFF_PROPOSAL_LEARNING_PIPELINE(docs/STAFF_PROPOSAL_LEARNING_PIPELINE_DESIGN.md §5.1.2)。
 * ProposalOrchestrator由来の実データ提案(GET /api/proposals/by-name)を表示し、
 * 表示できた場合のみ POST /api/proposals/fire を1回呼んで学習パイプラインへ記録する。
 *
 * ── 絶対ルール ──
 * UIデザイン変更禁止。色・spacing・border-radius・layout は
 * 既存 CustomerBottomSheet のスタイルを完全踏襲。
 */
import { useEffect, useRef, useState } from 'react'
import { authedFetch } from '@/lib/api/authedFetch'

interface AIProposalCardProps {
  customerId: string
  /**
   * CustomerBottomSheet側で既に算出済みのfallback文言(TYPE_COPYベースの定型文)を
   * そのまま渡す。ProposalOrchestratorから実データが取得できない場合はこれを表示する
   * (現状の見た目と完全に同一になる。CustomerBottomSheet側のfallback算出ロジックは無変更)。
   */
  fallbackAdvice: string
  fallbackNg:     string
}

interface ProposalByNameResponse {
  found:      boolean
  advice?:    string | null
  avoidNote?: string | null
}

export default function AIProposalCard({ customerId, fallbackAdvice, fallbackNg }: AIProposalCardProps) {
  const [advice,    setAdvice]    = useState<string | null>(null)
  const [avoidNote, setAvoidNote] = useState<string | null>(null)
  /** 同一customerIdへの二重fireを防止(React StrictModeの開発時二重実行対策)。
   *  サーバー側にも短時間重複抑止があるため、これは第一防波堤。 */
  const firedForRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false

    authedFetch(`/api/proposals/by-name?customerId=${encodeURIComponent(customerId)}`)
      .then(res => res.ok ? res.json() : null)
      .then((data: ProposalByNameResponse | null) => {
        if (cancelled || !data) return
        if (data.found && data.advice) {
          setAdvice(data.advice)
          setAvoidNote(data.avoidNote ?? null)

          if (firedForRef.current !== customerId) {
            firedForRef.current = customerId
            authedFetch('/api/proposals/fire', {
              method: 'POST',
              body:   JSON.stringify({ customerId }),
            }).catch(() => { /* fire失敗は非致命的、カード表示には影響させない */ })
          }
        }
      })
      .catch(() => { /* 取得失敗時はfallback表示のまま(何もしない) */ })

    return () => { cancelled = true }
  }, [customerId])

  const displayAdvice = advice ?? fallbackAdvice
  const displayNg     = advice ? (avoidNote ?? '') : fallbackNg

  return (
    <div className="bg-[#FFF8F7] rounded-[22px] p-4 border border-[#F5E6E8]">
      <p className="text-[11px] tracking-[0.2em] text-[#C8A58C] font-semibold mb-2.5">
        ✨ 今日の接客ポイント
      </p>
      <p className="text-sm text-[#5C4033] leading-[1.75]">{displayAdvice}</p>
      {displayNg && (
        <div className="mt-2.5 bg-[#FFF0F2] rounded-2xl p-2.5 flex gap-2">
          <span className="text-sm flex-shrink-0">⚠️</span>
          <div>
            <p className="text-[10px] text-[#C05060] tracking-[0.08em] mb-0.5">NGワード</p>
            <p className="text-sm text-[#C05060] leading-relaxed">{displayNg}</p>
          </div>
        </div>
      )}
    </div>
  )
}
