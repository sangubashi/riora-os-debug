'use client'
/**
 * ProductProposalSection.tsx
 * デジタル顧客カルテ Phase1-B③: 🛍前回の店販提案カード。
 *
 * 【最重要】これは「実際に購入された商品」ではない。brain_product_proposalsに
 * 保存された「スタッフが実際に提案したが、購入されたとは限らない」履歴のみを表示する。
 * 既存の「ホームケア使用商品」(brain_visits.retail_category由来の実購入集計、
 * homecareProducts state・/api/customers/[id]/homecare-products)とは
 * データソース・意味とも完全に別物であり、混在させない
 * (このコンポーネントはhomecareProducts等を一切参照しない・propsも受け取らない)。
 *
 * 【最重要】AI系モジュール(booking_prompts/handover_notes/NextActionPanel/
 * CustomerRiskCard/AIProposalCard等)は一切importしない。AIが推薦した商品を
 * ここへ表示・保存する処理は無い。
 *
 * GoalSection.tsx/StaffProposalSection.tsxと同じ「customerIdを受け取り
 * 自前でfetchする」自己完結コンポーネント。読み取り専用(GETのみ、POSTは
 * Phase1-B③のスコープ外)。
 *
 * 使用API: GET /api/customers/[id]/product-proposals(Phase1-A実装済み・無変更)。
 *
 * 2026-09-11仕様変更: 単独カードではなく「前回のサマリー」カード内のサブセクションとして
 * 埋め込む形に変更。外枠(背景色・角丸・padding)はCustomerBottomSheet側の親カードが持つため
 * このコンポーネントは持たない(見出し・内容のみ)。
 */
import { useState, useEffect, memo } from 'react'
import { authedFetch } from '@/lib/api/authedFetch'

interface ProductProposalSectionProps {
  customerId: string
}

/** brain_product_proposals.result のCHECK制約(4値)そのまま。新規追加しない。 */
type ProductProposalResult = 'purchased' | 'considering' | 'declined' | 'next_time'

interface ProductProposal {
  id:          string
  visitId:     string | null
  productName: string
  result:      ProductProposalResult
  staffId:     string | null
  createdAt:   string
}

const RESULT_LABELS: Record<ProductProposalResult, string> = {
  purchased:   '購入',
  considering: '検討中',
  declined:    '見送り',
  next_time:   '次回検討',
}

/** 画面に表示する件数の上限(表示上の間引きのみ。APIレスポンス自体は加工しない)。 */
const DISPLAY_LIMIT = 5

const ProductProposalSectionInner = memo(function ProductProposalSection({ customerId }: ProductProposalSectionProps) {
  const [proposals, setProposals] = useState<ProductProposal[]>([])
  const [loading,   setLoading]   = useState(true)

  // 顧客切替時に再取得。GETはcreated_at降順(API実装済み)のため、先頭がそのまま最新順になる。
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setProposals([])
    void (async () => {
      try {
        const res = await authedFetch(`/api/customers/${customerId}/product-proposals`)
        if (res.ok) {
          const json = await res.json() as { success: boolean; proposals?: ProductProposal[] }
          if (!cancelled && json.success) {
            setProposals(json.proposals ?? [])
          }
        }
        // 失敗時はloadingのみ解除し、空状態表示にフォールバックする
        // (読み取り専用表示のため、書き込み系のようなtoast.errorは出さない。
        //  BookingPromptSection/ContraindicationSection等の既存GET系表示と同じ方針)。
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [customerId])

  const visible = proposals.slice(0, DISPLAY_LIMIT)

  return (
    <div>
      <p className="text-[11px] tracking-[0.18em] text-[#C8A58C] font-semibold mb-2.5">🛍 前回の店販提案</p>

      {loading ? (
        <p className="text-xs text-[#C8A8B0] py-1">読み込み中…</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-[#5C4033] leading-relaxed">前回の店販提案はありません</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {visible.map(p => (
            <p key={p.id} className="text-sm text-[#5C4033] leading-relaxed break-words">
              ・{p.productName} — {RESULT_LABELS[p.result]}
            </p>
          ))}
        </div>
      )}
    </div>
  )
})

ProductProposalSectionInner.displayName = 'ProductProposalSection'
export default ProductProposalSectionInner
