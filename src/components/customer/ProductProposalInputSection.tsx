'use client'
/**
 * ProductProposalInputSection.tsx
 * デジタル顧客カルテ Phase1-B⑥: 🛍今日の店販提案・結果カード（「今日入力」エリア専用）。
 *
 * 【重要】ここで記録するのは「今日スタッフが実際に提案した商品」とその結果であり、
 * 以下とは明確に別物・混同しない：
 *   - 過去に購入して現在使用している商品(既存「ホームケア使用商品」、
 *     ProductProposalSection.tsxとも別。ProductProposalSectionは「見る」側の
 *     過去の店販提案履歴表示、本コンポーネントは「今日入力」側の新規記録専用)
 *   - brain_visits.retail_category / retail_amount(実購入・CSV由来)
 *   - staff_logs.retail_sold(booleanのKPIスナップショット)
 *   - AIによるホームケア商品提案(generateHomecarePlan.ts、HomecareAccordion)
 *   - AI Proposal / NextAction / CustomerRisk / BookingPrompt / Handover
 *
 * brain_product_proposalsは追記専用ログ(既存API・DB設計)のため、本コンポーネントは
 * 1件ずつPOSTするのみで、既存レコードの編集・削除ボタンは一切設けない。
 *
 * 使用API: GET/POST /api/customers/[id]/product-proposals(Phase1-A実装済み・無変更)。
 * GETは常にtodayVisitId限定(?visitId=)で呼び、今日の記録のみを表示する。
 *
 * todayVisitIdがnullの間はGET/POSTともに行わず、入力UIも表示しない
 * (saveLog()/service-completeを変更してvisitIdを作る処理は追加しない)。
 *
 * GoalSection/StaffProposalSection/ProductProposalSection/SkinConditionSection/
 * TreatmentRecordSectionと同じく自己完結コンポーネント。
 */
import { useState, useEffect, useCallback, memo } from 'react'
import { toast } from 'sonner'
import { authedFetch } from '@/lib/api/authedFetch'

interface ProductProposalInputSectionProps {
  customerId: string
  /** 本日分のbrain_visits.id。無い場合(通常は接客ログ保存前)はnull。 */
  todayVisitId: string | null
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

const RESULT_OPTIONS: Array<{ value: ProductProposalResult; label: string }> = [
  { value: 'purchased',   label: '購入' },
  { value: 'considering', label: '検討中' },
  { value: 'declined',    label: '見送り' },
  { value: 'next_time',   label: '次回検討' },
]

const RESULT_LABELS: Record<ProductProposalResult, string> = {
  purchased:   '購入',
  considering: '検討中',
  declined:    '見送り',
  next_time:   '次回検討',
}

const ProductProposalInputSectionInner = memo(function ProductProposalInputSection({
  customerId,
  todayVisitId,
}: ProductProposalInputSectionProps) {
  const [proposals,   setProposals]   = useState<ProductProposal[]>([])
  const [loading,     setLoading]     = useState(false)
  const [productName, setProductName] = useState('')
  const [result,      setResult]      = useState<ProductProposalResult | null>(null)
  const [saving,      setSaving]      = useState(false)

  const loadTodayProposals = useCallback(async (visitId: string): Promise<ProductProposal[]> => {
    const res = await authedFetch(
      `/api/customers/${customerId}/product-proposals?visitId=${visitId}`
    )
    if (!res.ok) return []
    const json = await res.json() as { success: boolean; proposals?: ProductProposal[] }
    return json.success ? (json.proposals ?? []) : []
  }, [customerId])

  // 顧客切替・本日visitIdの確定タイミングの両方でリセット+再取得する。
  // todayVisitIdがnullの間はGETしない(案内表示のみ)。
  useEffect(() => {
    let cancelled = false
    setProposals([])
    setProductName('')
    setResult(null)

    if (!todayVisitId) {
      setLoading(false)
      return
    }

    setLoading(true)
    void (async () => {
      try {
        const rows = await loadTodayProposals(todayVisitId)
        if (!cancelled) setProposals(rows)
        // 取得失敗時は空欄のまま続行する(loadTodayProposalsは失敗時[]を返す)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [customerId, todayVisitId, loadTodayProposals])

  const canSubmit = !saving && !!todayVisitId && productName.trim().length > 0 && result !== null

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !todayVisitId || !result) return // 二重送信防止・未入力ガード
    const trimmedName = productName.trim().slice(0, 200)
    setSaving(true)
    try {
      const res = await authedFetch(`/api/customers/${customerId}/product-proposals`, {
        method: 'POST',
        body: JSON.stringify({
          visitId:     todayVisitId,
          productName: trimmedName,
          result,
        }),
      })
      if (!res.ok) throw new Error('save failed')
      const json = await res.json() as { success: boolean; proposal?: ProductProposal }
      if (!json.success || !json.proposal) throw new Error('save failed')

      // 保存成功後は入力欄をクリアし、今日の一覧を再取得する
      setProductName('')
      setResult(null)
      const rows = await loadTodayProposals(todayVisitId)
      setProposals(rows)
      toast.success('店販提案を記録しました', { duration: 1500 })
    } catch {
      toast.error('店販提案の記録に失敗しました')
    } finally {
      setSaving(false)
    }
  }, [canSubmit, customerId, todayVisitId, productName, result, loadTodayProposals])

  return (
    <div className="bg-[#F8F1F3] rounded-[22px] p-4">
      <p className="text-[11px] tracking-[0.18em] text-[#C8A58C] font-semibold mb-2.5">
        🛍 今日の店販提案・結果
      </p>

      {!todayVisitId ? (
        <p className="text-xs text-[#C8A8B0] leading-relaxed">
          今日の接客記録を保存後に店販提案を記録できます
        </p>
      ) : loading ? (
        <p className="text-xs text-[#C8A8B0] py-1">読み込み中…</p>
      ) : (
        <div className="flex flex-col gap-3">
          {/* 今日の提案一覧(編集・削除ボタンは無し、追記専用ログのため) */}
          {proposals.length > 0 ? (
            <div className="flex flex-col gap-1">
              {proposals.map(p => (
                <p key={p.id} className="text-sm text-[#5C4033] leading-relaxed break-words">
                  ・{p.productName} — {RESULT_LABELS[p.result]}
                </p>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[#C8A8B0]">まだ今日の記録はありません</p>
          )}

          {/* 新規入力 */}
          <input
            value={productName}
            onChange={e => setProductName(e.target.value.slice(0, 200))}
            placeholder="商品名を入力"
            disabled={saving}
            className="w-full text-sm text-[#5C4033] bg-white rounded-xl px-3 py-2 border border-[#F0E0E4] outline-none disabled:opacity-60"
          />

          <div className="flex gap-1.5">
            {RESULT_OPTIONS.map(({ value, label }) => {
              const selected = result === value
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setResult(value)}
                  disabled={saving}
                  className={`flex-1 py-2 rounded-full text-xs font-semibold border cursor-pointer transition-colors disabled:cursor-default ${
                    selected
                      ? 'bg-[#F56E8B] text-white border-[#F56E8B]'
                      : 'bg-white text-[#9F7E6C] border-[#F5E6E8]'
                  } ${saving && !selected ? 'opacity-60' : ''}`}
                >
                  {label}
                </button>
              )
            })}
          </div>

          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={`w-full py-2.5 rounded-full text-sm font-bold text-white transition-colors ${
              !canSubmit ? 'bg-[#F5D6DB] cursor-default' : 'bg-[#F56E8B] cursor-pointer'
            }`}
          >
            {saving ? '記録中…' : '記録する'}
          </button>
        </div>
      )}
    </div>
  )
})

ProductProposalInputSectionInner.displayName = 'ProductProposalInputSection'
export default ProductProposalInputSectionInner
