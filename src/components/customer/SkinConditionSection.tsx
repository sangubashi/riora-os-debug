'use client'
/**
 * SkinConditionSection.tsx
 * デジタル顧客カルテ Phase1-B④: 📝今日の肌状態カード（「今日入力」エリア専用）。
 *
 * 保存先はbrain_skin_records(既存テーブル・既存列・既存CHECK制約は無変更)。
 * GET/POST /api/customers/[id]/skin-records(Phase1-A実装済み・無変更)のみを使用する。
 *
 * 【レベル値の意味について】
 * brain_skin_records.*_level は「0〜5段階」であることはDB/コード上で確認できるが、
 * 「0=良い/5=悪い」等の値の方向性を定義した仕様は既存コード・ドキュメントのどこにも
 * 存在しない(docs/CUSTOMER_BRIEFING_AUDIT_1.md 3-5でも「0-5段階」としか記載が無い)。
 * そのため本コンポーネントは各軸の名称(ニキビ/毛穴/乾燥/赤み/たるみ/くすみ/ハリ、
 * 既存のSKIN_TAG_LABELSと同じ語彙)のみを示し、「良い/悪い」等の意味づけは一切行わない
 * (数値そのものを選択させるだけの中立的なUI)。
 *
 * primary_deltaは既存POSTスキーマ(app/api/customers/[id]/skin-records/route.ts)が
 * 受け付けておらず、常にサーバー側でNULLのまま(自動算出は今回実装しない設計)。
 * この仕様に合わせ、本コンポーネントにはprimary_deltaの入力・表示を一切設けない。
 *
 * 【todayVisitIdについて】
 * brain_skin_records.visit_idはNOT NULL UNIQUEのため、来店(brain_visits行)が
 * 無ければ保存できない。CustomerBottomSheet.tsxが既に持つtodayVisitId
 * (visitHistoryの先頭が本日日付の場合のみ非nullになる、既存ロジック無変更)を
 * propとして受け取るのみで、saveLog()/service-complete側を変更してvisitIdを
 * 新規作成する処理は一切追加しない。todayVisitIdがnullの間は入力UI自体を
 * 表示せず、案内メッセージのみを表示する。
 *
 * GoalSection/StaffProposalSection/ProductProposalSectionと同じく自己完結
 * コンポーネント。AI系モジュール(AIProposalCard/NextActionPanel/CustomerRiskCard/
 * BookingPrompt等)は一切importしない。
 */
import { useState, useEffect, useCallback, memo } from 'react'
import { toast } from 'sonner'
import { authedFetch } from '@/lib/api/authedFetch'

interface SkinConditionSectionProps {
  customerId: string
  /** 本日分のbrain_visits.id。無い場合(通常は接客ログ保存前)はnull。 */
  todayVisitId: string | null
}

/** brain_skin_records.*_level の既存フィールド名(camelCase、API仕様に合わせる)。 */
type LevelKey =
  | 'acneLevel' | 'poreLevel' | 'drynessLevel' | 'rednessLevel'
  | 'saggingLevel' | 'dullnessLevel' | 'firmnessLevel'

type LevelState = Record<LevelKey, number | null>

const EMPTY_LEVELS: LevelState = {
  acneLevel: null, poreLevel: null, drynessLevel: null, rednessLevel: null,
  saggingLevel: null, dullnessLevel: null, firmnessLevel: null,
}

/** 既存SKIN_TAG_LABELS(src/types/index.ts)と同じ語彙を使う。「良い/悪い」等の意味づけはしない。 */
const LEVEL_FIELDS: Array<{ key: LevelKey; label: string }> = [
  { key: 'acneLevel',     label: 'ニキビ' },
  { key: 'poreLevel',     label: '毛穴' },
  { key: 'drynessLevel',  label: '乾燥' },
  { key: 'rednessLevel',  label: '赤み' },
  { key: 'saggingLevel',  label: 'たるみ' },
  { key: 'dullnessLevel', label: 'くすみ' },
  { key: 'firmnessLevel', label: 'ハリ' },
]

const LEVEL_VALUES = [0, 1, 2, 3, 4, 5] as const

interface SkinRecordApiShape {
  acneLevel:     number | null
  poreLevel:     number | null
  drynessLevel:  number | null
  rednessLevel:  number | null
  saggingLevel:  number | null
  dullnessLevel: number | null
  firmnessLevel: number | null
}

const SkinConditionSectionInner = memo(function SkinConditionSection({
  customerId,
  todayVisitId,
}: SkinConditionSectionProps) {
  const [levels,  setLevels]  = useState<LevelState>(EMPTY_LEVELS)
  const [loading, setLoading] = useState(false)
  const [saving,  setSaving]  = useState(false)

  // 顧客切替・本日visitIdの確定タイミングの両方でリセット+再取得する。
  // (visitIdがnullの間は取得せず、案内表示のみにする)
  useEffect(() => {
    let cancelled = false
    setLevels(EMPTY_LEVELS)

    if (!todayVisitId) {
      setLoading(false)
      return
    }

    setLoading(true)
    void (async () => {
      try {
        const res = await authedFetch(
          `/api/customers/${customerId}/skin-records?visitId=${todayVisitId}`
        )
        if (res.ok) {
          const json = await res.json() as { success: boolean; records?: SkinRecordApiShape[] }
          const existing = json.success ? json.records?.[0] : undefined
          if (!cancelled && existing) {
            setLevels({
              acneLevel:     existing.acneLevel,
              poreLevel:     existing.poreLevel,
              drynessLevel:  existing.drynessLevel,
              rednessLevel:  existing.rednessLevel,
              saggingLevel:  existing.saggingLevel,
              dullnessLevel: existing.dullnessLevel,
              firmnessLevel: existing.firmnessLevel,
            })
          }
        }
        // 取得失敗時は未入力状態のまま続行する(読み取り専用の事前補完に過ぎないため)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [customerId, todayVisitId])

  const selectLevel = useCallback((key: LevelKey, value: number) => {
    if (saving) return
    setLevels(prev => ({ ...prev, [key]: prev[key] === value ? null : value })) // 再タップで選択解除
  }, [saving])

  const handleSave = useCallback(async () => {
    if (saving || !todayVisitId) return // 二重送信防止・visitId無しでは送信しない
    const hasAnyValue = LEVEL_FIELDS.some(f => levels[f.key] !== null)
    if (!hasAnyValue) {
      toast.error('いずれか1項目を選択してください')
      return
    }
    setSaving(true)
    try {
      const body: Record<string, unknown> = { visitId: todayVisitId }
      for (const f of LEVEL_FIELDS) {
        if (levels[f.key] !== null) body[f.key] = levels[f.key]
      }
      const res = await authedFetch(`/api/customers/${customerId}/skin-records`, {
        method: 'POST',
        body:   JSON.stringify(body),
      })
      if (!res.ok) throw new Error('save failed')
      const json = await res.json() as { success: boolean; record?: SkinRecordApiShape }
      if (!json.success || !json.record) throw new Error('save failed')
      setLevels({
        acneLevel:     json.record.acneLevel,
        poreLevel:     json.record.poreLevel,
        drynessLevel:  json.record.drynessLevel,
        rednessLevel:  json.record.rednessLevel,
        saggingLevel:  json.record.saggingLevel,
        dullnessLevel: json.record.dullnessLevel,
        firmnessLevel: json.record.firmnessLevel,
      })
      toast.success('今日の肌状態を保存しました', { duration: 1500 })
    } catch {
      toast.error('今日の肌状態の保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }, [customerId, todayVisitId, levels, saving])

  return (
    <div className="bg-[#F8F1F3] rounded-[22px] p-4">
      <p className="text-[11px] tracking-[0.18em] text-[#C8A58C] font-semibold mb-2.5">
        📝 今日の肌状態
      </p>

      {!todayVisitId ? (
        <p className="text-xs text-[#C8A8B0] leading-relaxed">
          今日の接客記録を保存後に肌状態を記録できます
        </p>
      ) : loading ? (
        <p className="text-xs text-[#C8A8B0] py-1">読み込み中…</p>
      ) : (
        <div className="flex flex-col gap-3">
          {LEVEL_FIELDS.map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-[#5C4033] w-12 flex-shrink-0">{label}</span>
              <div className="flex gap-1 flex-1 justify-end">
                {LEVEL_VALUES.map(v => {
                  const selected = levels[key] === v
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() => selectLevel(key, v)}
                      disabled={saving}
                      className={`w-7 h-7 rounded-full text-xs font-semibold border cursor-pointer transition-all disabled:cursor-default ${
                        selected
                          ? 'bg-[#F56E8B] text-white border-[#F56E8B]'
                          : 'bg-white text-[#9F7E6C] border-[#F0E0E4]'
                      } ${saving && !selected ? 'opacity-60' : ''}`}
                    >
                      {v}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          <button
            onClick={handleSave}
            disabled={saving}
            className={`w-full py-2.5 rounded-full text-sm font-bold text-white transition-colors mt-1 ${
              saving ? 'bg-[#F5D6DB] cursor-default' : 'bg-[#F56E8B] cursor-pointer'
            }`}
          >
            {saving ? '保存中…' : '今日の肌状態を保存'}
          </button>
        </div>
      )}
    </div>
  )
})

SkinConditionSectionInner.displayName = 'SkinConditionSection'
export default SkinConditionSectionInner
