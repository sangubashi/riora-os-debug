'use client'
/**
 * TreatmentRecordViewSection.tsx
 * デジタル顧客カルテ Phase1-B⑧: 🧴前回の施術記録カード（「見る」側・読み取り専用）。
 *
 * B⑤(TreatmentRecordSection.tsx、今日入力側)が保存したbrain_visits.options/
 * products_used/treatment_memoを、次回来店時に「前回情報」として確認できるように
 * する表示専用コンポーネント。編集・削除・保存機能は一切持たない。
 *
 * 既存の「前回施術」カード(visitHistory[0]由来、日付/メニュー名/金額を表示)とは
 * 表示項目が重複しない(そちらは変更しない)。本コンポーネントはoptions/
 * productsUsed/treatmentMemoの3項目のみを扱う。
 *
 * 使用API: GET /api/customers/[id]/visits/[visitId]/treatment(Phase1-A実装済み・
 * 無変更)のみ。新しいstate/API取得処理はCustomerBottomSheet側に追加せず、
 * 既存のvisitHistory/todayVisitIdをpropとして受け取り、「前回visitId」は
 * このコンポーネント内だけで導出する。
 *
 * 「前回visitId」の導出は、todayVisitIdの一致だけでなくvisitDateが本日か
 * どうかも確認する(念のための二重チェック)。前回visitが存在しない場合は
 * GET自体を行わない。
 *
 * GoalSection等と同じ自己完結コンポーネント。AI系モジュールは一切importしない。
 *
 * 2026-09-11仕様変更: 単独カードではなく「前回のサマリー」カード内のサブセクションとして
 * 埋め込む形に変更。外枠(背景色・角丸・padding)はCustomerBottomSheet側の親カードが持つため
 * このコンポーネントは持たない(見出し・内容のみ)。
 */
import { useState, useEffect, useMemo, memo } from 'react'
import { authedFetch } from '@/lib/api/authedFetch'

/** CustomerBottomSheet.VisitHistoryEntryの必要最小限の形(型はexportされていないためローカル定義)。 */
interface VisitHistoryItem {
  id:        string
  visitDate: string
}

interface TreatmentRecordViewSectionProps {
  customerId:   string
  visitHistory: VisitHistoryItem[]
  /** 本日分のbrain_visits.id。前回visitから今日自身を除外するために使う。 */
  todayVisitId: string | null
}

interface TreatmentDetail {
  options:       unknown
  productsUsed:  unknown
  treatmentMemo: string | null
}

/** APIはunknown(自由形式JSON)で返すため、文字列要素のみを安全に取り出す。 */
function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string')
}

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10)
}

const TreatmentRecordViewSectionInner = memo(function TreatmentRecordViewSection({
  customerId,
  visitHistory,
  todayVisitId,
}: TreatmentRecordViewSectionProps) {
  const [options,       setOptions]       = useState<string[]>([])
  const [productsUsed,  setProductsUsed]  = useState<string[]>([])
  const [treatmentMemo, setTreatmentMemo] = useState<string | null>(null)
  const [loading,       setLoading]       = useState(true)
  const [hasRecord,     setHasRecord]     = useState(false)

  // 「前回visitId」の導出。todayVisitIdの一致だけでなく、visitDateが本日かどうかも
  // 確認する二重チェックにする(念のため、todayVisitIdが何らかの理由で古い値の
  // ままでも安全側に倒せるように)。
  const previousVisitId = useMemo(() => {
    const todayStr = todayDateStr()
    const isTodaysVisit = (v: VisitHistoryItem) => v.id === todayVisitId || v.visitDate === todayStr
    const previous = visitHistory.find(v => !isTodaysVisit(v))
    return previous?.id ?? null
  }, [visitHistory, todayVisitId])

  useEffect(() => {
    let cancelled = false
    setOptions([])
    setProductsUsed([])
    setTreatmentMemo(null)
    setHasRecord(false)

    // 前回visitが存在しない場合はGETしない
    if (!previousVisitId) {
      setLoading(false)
      return
    }

    setLoading(true)
    void (async () => {
      try {
        const res = await authedFetch(
          `/api/customers/${customerId}/visits/${previousVisitId}/treatment`
        )
        if (res.ok) {
          const json = await res.json() as { success: boolean; treatment?: TreatmentDetail }
          if (!cancelled && json.success && json.treatment) {
            setOptions(toStringList(json.treatment.options))
            setProductsUsed(toStringList(json.treatment.productsUsed))
            setTreatmentMemo(json.treatment.treatmentMemo)
            setHasRecord(true)
          }
        }
        // 取得失敗(該当visitに施術記録が無い404等含む)時は空状態にフォールバックする
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [customerId, previousVisitId])

  const isEmpty = !hasRecord
    || (options.length === 0 && productsUsed.length === 0 && !treatmentMemo?.trim())

  return (
    <div>
      <p className="text-[11px] tracking-[0.18em] text-[#C8A58C] font-semibold mb-2.5">
        🧴 前回の施術記録
      </p>

      {loading ? (
        <p className="text-xs text-[#C8A8B0] py-1">読み込み中…</p>
      ) : isEmpty ? (
        <p className="text-sm text-[#5C4033] leading-relaxed">前回の詳細な施術記録はありません</p>
      ) : (
        <div className="flex flex-col gap-2">
          {options.length > 0 && (
            <div>
              <p className="text-xs text-[#9F7E6C] mb-0.5">オプション</p>
              <p className="text-sm text-[#5C4033] leading-relaxed break-words">
                {options.join('、')}
              </p>
            </div>
          )}
          {productsUsed.length > 0 && (
            <div>
              <p className="text-xs text-[#9F7E6C] mb-0.5">使用製品</p>
              <p className="text-sm text-[#5C4033] leading-relaxed break-words">
                {productsUsed.join('、')}
              </p>
            </div>
          )}
          {treatmentMemo?.trim() && (
            <div>
              <p className="text-xs text-[#9F7E6C] mb-0.5">施術メモ</p>
              <p className="text-sm text-[#5C4033] leading-relaxed whitespace-pre-wrap break-words">
                {treatmentMemo}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
})

TreatmentRecordViewSectionInner.displayName = 'TreatmentRecordViewSection'
export default TreatmentRecordViewSectionInner
