'use client'
/**
 * TreatmentRecordSection.tsx
 * デジタル顧客カルテ Phase1-B⑤: 🧴今日の施術記録カード（「今日入力」エリア専用）。
 *
 * 保存先はbrain_visits.options/products_used/treatment_memo(Phase1-Aで追加済みの
 * 既存列。machine_settingsは今回のUIには含めない、キー・値の仕様が未確定のため)。
 * GET/PATCH /api/customers/[id]/visits/[visitId]/treatment(Phase1-A実装済み・
 * 無変更)のみを使用する。新規APIは作らない。
 *
 * 【重要】これは「AIが提案した施術」ではなく「スタッフが今日実際に行った施術」の記録。
 * AI系モジュール(AIProposalCard/NextActionPanel/CustomerRiskCard/BookingPrompt/
 * HandoverSection等)は一切importしない。
 *
 * options/productsUsedは自由テキストの追記式リスト(文字列配列)として保存する。
 * brain_menus等から選択肢を自動生成する処理・新しいマスタは一切作らない。
 *
 * 【todayVisitIdについて】SkinConditionSection.tsxと同じ考え方。
 * saveLog()/service-completeを変更してvisitIdを新規作成する処理は追加しない。
 * todayVisitIdがnullの間は入力UIを表示せず、案内メッセージのみを表示する。
 *
 * GoalSection/StaffProposalSection/ProductProposalSection/SkinConditionSectionと
 * 同じく自己完結コンポーネント。
 */
import { useState, useEffect, useCallback, memo } from 'react'
import { toast } from 'sonner'
import { authedFetch } from '@/lib/api/authedFetch'

interface TreatmentRecordSectionProps {
  customerId: string
  /** 本日分のbrain_visits.id。無い場合(通常は接客ログ保存前)はnull。 */
  todayVisitId: string | null
}

interface TreatmentApiShape {
  visitId:         string
  options:         unknown
  productsUsed:    unknown
  machineSettings: unknown
  treatmentMemo:   string | null
}

/** APIはunknown[]で返す(自由形式JSON)ため、文字列要素のみを安全に取り出す。 */
function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string')
}

const TreatmentRecordSectionInner = memo(function TreatmentRecordSection({
  customerId,
  todayVisitId,
}: TreatmentRecordSectionProps) {
  const [options,       setOptions]       = useState<string[]>([])
  const [productsUsed,  setProductsUsed]  = useState<string[]>([])
  const [treatmentMemo, setTreatmentMemo] = useState('')
  const [optionDraft,   setOptionDraft]   = useState('')
  const [productDraft,  setProductDraft]  = useState('')
  const [loading,       setLoading]       = useState(false)
  const [saving,        setSaving]        = useState(false)

  // 顧客切替・本日visitIdの確定タイミングの両方でリセット+再取得する。
  useEffect(() => {
    let cancelled = false
    setOptions([])
    setProductsUsed([])
    setTreatmentMemo('')
    setOptionDraft('')
    setProductDraft('')

    if (!todayVisitId) {
      setLoading(false)
      return
    }

    setLoading(true)
    void (async () => {
      try {
        const res = await authedFetch(
          `/api/customers/${customerId}/visits/${todayVisitId}/treatment`
        )
        if (res.ok) {
          const json = await res.json() as { success: boolean; treatment?: TreatmentApiShape }
          if (!cancelled && json.success && json.treatment) {
            setOptions(toStringList(json.treatment.options))
            setProductsUsed(toStringList(json.treatment.productsUsed))
            setTreatmentMemo(json.treatment.treatmentMemo ?? '')
          }
        }
        // 取得失敗時は空欄のまま続行する(読み取り専用の事前補完に過ぎないため)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [customerId, todayVisitId])

  const addOption = useCallback(() => {
    const v = optionDraft.trim()
    if (!v || saving) return
    setOptions(prev => [...prev, v])
    setOptionDraft('')
  }, [optionDraft, saving])

  const removeOption = useCallback((index: number) => {
    if (saving) return
    setOptions(prev => prev.filter((_, i) => i !== index))
  }, [saving])

  const addProduct = useCallback(() => {
    const v = productDraft.trim()
    if (!v || saving) return
    setProductsUsed(prev => [...prev, v])
    setProductDraft('')
  }, [productDraft, saving])

  const removeProduct = useCallback((index: number) => {
    if (saving) return
    setProductsUsed(prev => prev.filter((_, i) => i !== index))
  }, [saving])

  const handleSave = useCallback(async () => {
    if (saving || !todayVisitId) return // 二重送信防止・visitId無しでは送信しない
    setSaving(true)
    try {
      // 空文字の項目は保存前に除外する
      const cleanedOptions      = options.map(o => o.trim()).filter(Boolean)
      const cleanedProductsUsed = productsUsed.map(p => p.trim()).filter(Boolean)
      const memoTrimmed         = treatmentMemo.trim()

      const res = await authedFetch(
        `/api/customers/${customerId}/visits/${todayVisitId}/treatment`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            options:       cleanedOptions,
            productsUsed:  cleanedProductsUsed,
            treatmentMemo: memoTrimmed.length > 0 ? memoTrimmed : null,
            // machineSettingsは今回のUIに含めないため送信しない
          }),
        }
      )
      if (!res.ok) throw new Error('save failed')
      const json = await res.json() as { success: boolean; treatment?: TreatmentApiShape }
      if (!json.success || !json.treatment) throw new Error('save failed')

      setOptions(toStringList(json.treatment.options))
      setProductsUsed(toStringList(json.treatment.productsUsed))
      setTreatmentMemo(json.treatment.treatmentMemo ?? '')
      toast.success('今日の施術記録を保存しました', { duration: 1500 })
    } catch {
      toast.error('今日の施術記録の保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }, [customerId, todayVisitId, options, productsUsed, treatmentMemo, saving])

  return (
    <div className="bg-[#F8F1F3] rounded-[22px] p-4">
      <p className="text-[11px] tracking-[0.18em] text-[#C8A58C] font-semibold mb-2.5">
        🧴 今日の施術記録
      </p>

      {!todayVisitId ? (
        <p className="text-xs text-[#C8A8B0] leading-relaxed">
          今日の接客記録を保存後に施術記録を入力できます
        </p>
      ) : loading ? (
        <p className="text-xs text-[#C8A8B0] py-1">読み込み中…</p>
      ) : (
        <div className="flex flex-col gap-3.5">
          {/* オプション */}
          <div>
            <p className="text-xs font-medium text-[#5C4033] mb-1.5">オプション</p>
            <div className="flex flex-col gap-1.5">
              {options.map((opt, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="flex-1 text-sm text-[#5C4033] bg-white rounded-xl px-3 py-1.5 border border-[#F0E0E4] break-words">
                    {opt}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeOption(i)}
                    disabled={saving}
                    aria-label="オプションを削除"
                    className="w-7 h-7 flex-shrink-0 rounded-full bg-white border border-[#F0E0E4] text-[#C8A58C] cursor-pointer disabled:cursor-default"
                  >
                    ×
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-1.5">
                <input
                  value={optionDraft}
                  onChange={e => setOptionDraft(e.target.value.slice(0, 100))}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addOption() } }}
                  placeholder="オプション名を入力"
                  disabled={saving}
                  className="flex-1 text-sm text-[#5C4033] bg-white rounded-xl px-3 py-1.5 border border-[#F0E0E4] outline-none disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={addOption}
                  disabled={saving || !optionDraft.trim()}
                  className="flex-shrink-0 text-xs font-semibold text-[#F56E8B] bg-white border border-[#F5C6D0] rounded-full px-3 py-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-default"
                >
                  ＋追加
                </button>
              </div>
            </div>
          </div>

          {/* 使用製品 */}
          <div>
            <p className="text-xs font-medium text-[#5C4033] mb-1.5">使用製品</p>
            <div className="flex flex-col gap-1.5">
              {productsUsed.map((p, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="flex-1 text-sm text-[#5C4033] bg-white rounded-xl px-3 py-1.5 border border-[#F0E0E4] break-words">
                    {p}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeProduct(i)}
                    disabled={saving}
                    aria-label="使用製品を削除"
                    className="w-7 h-7 flex-shrink-0 rounded-full bg-white border border-[#F0E0E4] text-[#C8A58C] cursor-pointer disabled:cursor-default"
                  >
                    ×
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-1.5">
                <input
                  value={productDraft}
                  onChange={e => setProductDraft(e.target.value.slice(0, 100))}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addProduct() } }}
                  placeholder="使用製品名を入力"
                  disabled={saving}
                  className="flex-1 text-sm text-[#5C4033] bg-white rounded-xl px-3 py-1.5 border border-[#F0E0E4] outline-none disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={addProduct}
                  disabled={saving || !productDraft.trim()}
                  className="flex-shrink-0 text-xs font-semibold text-[#F56E8B] bg-white border border-[#F5C6D0] rounded-full px-3 py-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-default"
                >
                  ＋追加
                </button>
              </div>
            </div>
          </div>

          {/* 施術メモ */}
          <div>
            <p className="text-xs font-medium text-[#5C4033] mb-1.5">施術メモ</p>
            <textarea
              value={treatmentMemo}
              onChange={e => setTreatmentMemo(e.target.value.slice(0, 1000))}
              placeholder="今日実際に行った施術内容・施術上のメモ"
              rows={3}
              disabled={saving}
              className="w-full resize-none text-sm text-[#5C4033] bg-white rounded-2xl p-3 border border-[#F5E6E8] outline-none leading-relaxed font-['Noto_Sans_JP'] box-border disabled:opacity-60"
            />
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className={`w-full py-2.5 rounded-full text-sm font-bold text-white transition-colors ${
              saving ? 'bg-[#F5D6DB] cursor-default' : 'bg-[#F56E8B] cursor-pointer'
            }`}
          >
            {saving ? '保存中…' : '施術記録を保存'}
          </button>
        </div>
      )}
    </div>
  )
})

TreatmentRecordSectionInner.displayName = 'TreatmentRecordSection'
export default TreatmentRecordSectionInner
