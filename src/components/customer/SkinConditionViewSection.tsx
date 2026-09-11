'use client'
/**
 * SkinConditionViewSection.tsx
 * デジタル顧客カルテ Phase1-B⑧: 📝前回の肌状態カード（「見る」側・読み取り専用）。
 *
 * B④(SkinConditionSection.tsx、今日入力側)が保存したbrain_skin_recordsを、
 * 次回来店時に「前回情報」として確認できるようにする表示専用コンポーネント。
 * 編集・削除・保存機能は一切持たない。
 *
 * 使用API: GET /api/customers/[id]/skin-records(Phase1-A実装済み・無変更)のみ。
 * visitId指定なしで全件取得し、todayVisitIdに一致する行(=今日自身の記録)を
 * クライアント側で除外してから先頭(created_at最新)を「前回」として表示する
 * (今日のvisitがまだ無い場合はtodayVisitId=nullのため除外は発生せず、
 * 先頭がそのまま前回になる)。
 *
 * primary_deltaは表示しない(サーバー側で常にNULLのため)。levelの0〜5の値に
 * 「良い/悪い」等の意味づけは行わず、数値をそのまま表示する。
 *
 * GoalSection等と同じ自己完結コンポーネント。AI系モジュールは一切importしない。
 *
 * 2026-09-11仕様変更: 単独カードではなく「前回のサマリー」カード内のサブセクションとして
 * 埋め込む形に変更。外枠(背景色・角丸・padding)はCustomerBottomSheet側の親カードが持つため
 * このコンポーネントは持たない(見出し・内容のみ)。
 */
import { useState, useEffect, memo } from 'react'
import { authedFetch } from '@/lib/api/authedFetch'

interface SkinConditionViewSectionProps {
  customerId: string
  /** 本日分のbrain_visits.id。今日自身の記録を「前回」から除外するために使う。 */
  todayVisitId: string | null
}

interface SkinRecord {
  visitId:       string
  acneLevel:     number | null
  poreLevel:     number | null
  drynessLevel:  number | null
  rednessLevel:  number | null
  saggingLevel:  number | null
  dullnessLevel: number | null
  firmnessLevel: number | null
}

const LEVEL_FIELDS: Array<{ key: keyof Omit<SkinRecord, 'visitId'>; label: string }> = [
  { key: 'acneLevel',     label: 'ニキビ' },
  { key: 'poreLevel',     label: '毛穴' },
  { key: 'drynessLevel',  label: '乾燥' },
  { key: 'rednessLevel',  label: '赤み' },
  { key: 'saggingLevel',  label: 'たるみ' },
  { key: 'dullnessLevel', label: 'くすみ' },
  { key: 'firmnessLevel', label: 'ハリ' },
]

const SkinConditionViewSectionInner = memo(function SkinConditionViewSection({
  customerId,
  todayVisitId,
}: SkinConditionViewSectionProps) {
  const [record,  setRecord]  = useState<SkinRecord | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setRecord(null)
    setLoading(true)

    void (async () => {
      try {
        const res = await authedFetch(`/api/customers/${customerId}/skin-records`)
        if (res.ok) {
          const json = await res.json() as { success: boolean; records?: SkinRecord[] }
          if (!cancelled && json.success) {
            // 今日自身の記録(todayVisitIdに一致する行)を除外してから先頭を「前回」とする
            const previous = (json.records ?? []).find(r => r.visitId !== todayVisitId)
            setRecord(previous ?? null)
          }
        }
        // 取得失敗時は「前回情報なし」の空状態にフォールバックする(読み取り専用のため)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [customerId, todayVisitId])

  return (
    <div>
      <p className="text-[11px] tracking-[0.18em] text-[#C8A58C] font-semibold mb-2.5">
        📝 前回の肌状態
      </p>

      {loading ? (
        <p className="text-xs text-[#C8A8B0] py-1">読み込み中…</p>
      ) : !record ? (
        <p className="text-sm text-[#5C4033] leading-relaxed">前回の肌状態はまだ記録されていません</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {LEVEL_FIELDS.map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between">
              <span className="text-xs text-[#9F7E6C]">{label}</span>
              <span className="text-sm font-semibold text-[#5C4033]">
                {record[key] === null ? '未記録' : record[key]}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
})

SkinConditionViewSectionInner.displayName = 'SkinConditionViewSection'
export default SkinConditionViewSectionInner
