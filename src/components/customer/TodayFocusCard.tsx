'use client'
/**
 * TodayFocusCard.tsx (旧 AIProposalCard.tsx)
 * CustomerBottomSheet 内「✨ 今日の接客ポイント」カード本体。
 *
 * 2026-09-11仕様変更: 抽象的な推測表現(旧ProposalOrchestrator advice / TYPE_COPY定型文)を
 * やめ、customer_memories(覚えておくこと)の中から最も重要度が高く直近に記録された
 * 事実を「前回：〇〇」という過去の記録として表示する形に変更した。
 * NGワードは画面最上部の固定ブロックへ移設済み(CustomerBottomSheet.tsxのTYPE_COPY.ng・
 * 顧客タイプ別定型文をそのまま使用。ProposalOrchestrator由来のavoidNoteは、advice自体を
 * このカードで表示しなくなったことに伴い/api/proposals/fireごと廃止した)。
 *
 * customer_memoriesの取得のみ・表示のみ(ProposalOrchestrator/FireScore等の接客支援AIへは
 * 渡さない。app/api/customer-memories/route.tsのコメントに準拠)。
 */
import { useEffect, useState } from 'react'
import { authedFetch } from '@/lib/api/authedFetch'
import type { CustomerMemory } from '@/types/customerMemory'

interface TodayFocusCardProps {
  customerId: string
}

const IMPORTANCE_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 }

export default function TodayFocusCard({ customerId }: TodayFocusCardProps) {
  const [fact,    setFact]    = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setFact(null)

    authedFetch(`/api/customer-memories?customer_id=${encodeURIComponent(customerId)}`)
      .then(res => res.ok ? res.json() : null)
      .then((data: { memories?: CustomerMemory[] } | null) => {
        if (cancelled || !data?.memories) return
        const top = data.memories
          .filter(m => !m.is_sensitive)
          .sort((a, b) => {
            const d = (IMPORTANCE_ORDER[a.importance] ?? 1) - (IMPORTANCE_ORDER[b.importance] ?? 1)
            if (d !== 0) return d
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          })[0]
        if (top) setFact(top.content)
      })
      .catch(() => { /* 取得失敗時は空状態のまま */ })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [customerId])

  return (
    <div className="bg-[#FFF8F7] rounded-[22px] p-4 border border-[#F5E6E8]">
      <p className="text-[11px] tracking-[0.2em] text-[#C8A58C] font-semibold mb-2.5">
        ✨ 今日の接客ポイント
      </p>
      {loading ? (
        <p className="text-xs text-[#C8A8B0] py-1">読み込み中…</p>
      ) : fact ? (
        <p className="text-sm text-[#5C4033] leading-[1.75]">前回：{fact}</p>
      ) : (
        <p className="text-sm text-[#9F7E6C] leading-[1.75]">特記事項はまだ記録されていません</p>
      )}
    </div>
  )
}
