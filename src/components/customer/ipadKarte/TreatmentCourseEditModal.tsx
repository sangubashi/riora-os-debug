'use client'
/**
 * TreatmentCourseEditModal.tsx — 「✏️」メインコース選択モーダル(2026-09-28ユーザー承認)。
 *
 * `/karte`のPIN保護スタッフモード(IpadStaffKarteView.tsx)専用。「今回の施術」の
 * うち「メインコース」枠を担当する(固定14項目からの複数選択・ON/OFFトグル)。
 * 「追加オプション」枠は別コンポーネント TreatmentOptionEditModal.tsx が担当する
 * (option_items列、互いのPUTは相手の選択内容を上書きしない)。
 *
 * 保存先API(PUT /api/customers/[id]/today-treatment-course、2026-09-28追加対応)は
 * 「本日分のbrain_visits行が無ければその場で作成し、course_optionsを保存する」設計
 * (brain_visitsは実際には翌日以降のSalonBoard CSVインポートで一括作成されるため、
 * 来店当日にはvisitが存在しないことがほとんどだった。「現場の入力が正である」という
 * 方針(ユーザー承認)のもと、visitIdを事前に知らなくても保存できるようにした)。
 * 過去来店の編集(2026-09-28ユーザー承認・/karte「来店履歴」): visitIdを指定した場合のみ、
 * PUT /today-treatment-course(本日分を前提とする経路)の代わりに
 * PATCH /api/customers/[id]/visits/[visitId]/treatment(任意のvisitIdに対応済み、
 * visitId未指定時の挙動には一切影響しない)を使う。course_options/option_itemsは
 * csvImportPipeline.ts の reconcile() が更新するフィールド(staffId/menuId/
 * isNomination/treatmentAmount/retailAmount/checkoutId)に含まれないため、
 * 過去来店(SalonBoard CSV取込由来)の行を編集してもsource列や他の値には一切影響せず、
 * 翌日以降のCSV再取込で上書きされることもない(brain_visits.source列自体は変更しない)。
 */
import { useState } from 'react'
import { X, Check } from 'lucide-react'
import { authedFetch } from '@/lib/api/authedFetch'
import { PALETTE, headingFont } from '@/components/customer/shared/PhotoCompareKit'

/**
 * コース選択肢の固定14項目(2026-09-28ユーザー承認、依頼どおりの文言・順序)。
 * 「(内容カルテ記入)」付きの項目は、コース内容が都度変わるためカルテメモへの
 * 別途記入を前提とする(この選択自体は「どのコースを実施したか」のフラグのみ)。
 */
export const TREATMENT_COURSE_OPTIONS = [
  'サブスク消化(内容カルテ記入)',
  '回数券消化(内容カルテ記入)',
  'スク→ポレ→マイカレ→乳歯パック',
  'ハイドラ→ポレ→マイカレ→乳歯パック',
  'スク→ポレ→マイカレ→→水素→乳歯パック',
  'スク→ハーブ3→4→ポレ→5→肌別パック',
  'スク→ハーブ345→肌別パック(ツルピカ)',
  'スク→ポレ→EMS→FM→乳歯パック',
  'スク→ハイフ→ポレ→乳歯パック',
  '造顔→ハイフ→ポレ→乳歯パック',
  'スク→ポレ→炭酸',
  'ハーブ345→導入パック→乳歯パック',
  'メンズハイドラ(内容カルテ記入)',
  '背中ケア(内容カルテ記入)',
] as const

interface Props {
  customerId: string
  existing:   string[]
  onClose:    () => void
  /** 保存成功時に呼ばれる(親側で今回の施術コース表示・todayVisitIdを更新する想定)。 */
  onSaved:    (visitId: string, courseOptions: string[]) => void
  /** 指定時は過去来店の編集モード(PATCH /visits/[visitId]/treatment)になる。未指定時は
   *  従来通り本日分(PUT /today-treatment-course)。 */
  visitId?:   string
}

interface PutResponse {
  success:        boolean
  visitId?:       string
  courseOptions?: unknown
  error?:         string
}

interface PatchResponse {
  success:    boolean
  treatment?: { visitId: string; courseOptions?: unknown }
  error?:     string
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string')
}

export default function TreatmentCourseEditModal({ customerId, existing, onClose, onSaved, visitId }: Props) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(existing))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggle(label: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  async function handleSave() {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      if (visitId) {
        const res = await authedFetch(`/api/customers/${customerId}/visits/${visitId}/treatment`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ courseOptions: Array.from(selected) }),
        })
        const json = await res.json() as PatchResponse
        if (!res.ok || !json.success || !json.treatment) {
          setError('保存に失敗しました')
          return
        }
        onSaved(json.treatment.visitId, toStringList(json.treatment.courseOptions))
        onClose()
        return
      }

      const res = await authedFetch(`/api/customers/${customerId}/today-treatment-course`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ courseOptions: Array.from(selected) }),
      })
      const json = await res.json() as PutResponse
      if (!res.ok || !json.success || !json.visitId) {
        setError('保存に失敗しました')
        return
      }
      onSaved(json.visitId, toStringList(json.courseOptions))
      onClose()
    } catch {
      setError('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{
        background: PALETTE.bg, borderRadius: '16px', maxWidth: '520px', width: '100%',
        maxHeight: '85vh', overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <p style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: PALETTE.text, fontFamily: headingFont.style.fontFamily }}>
            メインコースを選択
          </p>
          <button type="button" onClick={onClose} aria-label="閉じる" style={{ background: 'none', border: 'none', cursor: 'pointer', color: PALETTE.muted }}>
            <X size={20} />
          </button>
        </div>

        <p style={{ margin: 0, fontSize: '12px', color: PALETTE.muted, lineHeight: 1.6 }}>
          該当する項目をタップしてON/OFFしてください。ONにした項目は画面に即座に反映されます。
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {TREATMENT_COURSE_OPTIONS.map(label => {
            const isOn = selected.has(label)
            return (
              <button
                key={label}
                type="button"
                onClick={() => toggle(label)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px', textAlign: 'left',
                  padding: '10px 12px', borderRadius: '12px', cursor: 'pointer',
                  border: `1.5px solid ${isOn ? PALETTE.gold : PALETTE.border}`,
                  background: isOn ? 'rgba(173,138,84,0.10)' : 'none',
                }}
              >
                <span style={{
                  flexShrink: 0, width: '20px', height: '20px', borderRadius: '6px',
                  border: `1.5px solid ${isOn ? PALETTE.gold : PALETTE.muted}`,
                  background: isOn ? PALETTE.gold : 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {isOn && <Check size={13} color="#fff" strokeWidth={3} />}
                </span>
                <span style={{ flex: 1, fontSize: '13px', fontWeight: 600, color: isOn ? PALETTE.gold : PALETTE.text }}>
                  {label}
                </span>
              </button>
            )
          })}
        </div>

        {error && <p style={{ margin: 0, fontSize: '12px', color: '#B85050' }}>{error}</p>}

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            style={{ fontSize: '13px', padding: '8px 16px', borderRadius: '999px', border: `1px solid ${PALETTE.border}`, background: 'none', color: PALETTE.muted, cursor: 'pointer' }}
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              fontSize: '13px', fontWeight: 700, padding: '8px 18px', borderRadius: '999px',
              border: 'none', background: saving ? PALETTE.border : PALETTE.gold, color: '#fff',
              cursor: saving ? 'default' : 'pointer',
            }}
          >
            <Check size={14} />{saving ? '保存中…' : '保存する'}
          </button>
        </div>
      </div>
    </div>
  )
}
