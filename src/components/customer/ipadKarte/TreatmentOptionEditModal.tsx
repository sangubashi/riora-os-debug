'use client'
/**
 * TreatmentOptionEditModal.tsx — 「✏️」追加オプション選択モーダル(2026-09-28ユーザー承認)。
 *
 * `/karte`のPIN保護スタッフモード(IpadStaffKarteView.tsx)専用。「今回の施術」の
 * うち「追加オプション」枠を担当する(固定26項目・4カテゴリからの複数選択・ON/OFFトグル)。
 * 「メインコース」枠は別コンポーネント TreatmentCourseEditModal.tsx が担当する
 * (course_options列、互いのPUTは相手の選択内容を上書きしない)。
 *
 * 保存先API(PUT /api/customers/[id]/today-treatment-course)はTreatmentCourseEditModal.tsx
 * と共通で、optionItemsのみを送信する(courseOptionsは未指定のまま=更新しない)。
 * このモーダル自身もvisitIdを一切扱わない(customerIdのみで完結)。
 */
import { useState } from 'react'
import { X, Check } from 'lucide-react'
import { authedFetch } from '@/lib/api/authedFetch'
import { PALETTE, headingFont } from '@/components/customer/shared/PhotoCompareKit'

/**
 * 追加オプションの固定カテゴリ・項目(2026-09-28ユーザー承認、依頼どおりの文言・順序)。
 * ユーザー依頼文言では「25項目」と案内されたが、列挙された実項目数は26件のため、
 * 記入された項目リストをそのまま(削らずに)採用している。
 */
export const TREATMENT_OPTION_CATEGORIES = [
  {
    category: 'クレンジング・毛穴・ピーリング',
    items: [
      'スクライバー',
      'ハイドラフェイシャル 1部位',
      'ハイドラフェイシャル 全顔',
      'ハーブピーリング (全顔)',
      'ハーブピーリング＋肌別パック (全顔)',
      '毛穴スチーム',
      '背中ハーブピーリング',
    ],
  },
  {
    category: '導入・マシン',
    items: [
      'ヒト幹細胞導入 (乳歯髄)',
      'ヒト幹細胞導入 (臍帯血)',
      'マイクロカレント',
      'ビタミンC導入',
      '生コラーゲン エアバリ導入',
      'EMS',
      'エアバリ',
      'ラジオ波 (顔)',
    ],
  },
  {
    category: 'パック・塗布',
    items: [
      '高濃度ヒト幹細胞パック',
      '水素パック',
      'モデリングパック各種 (海藻/黒炭/パール)',
      '炭酸パック (オールスキン)',
      '炭酸パック (プレミアム)',
      '導入パック各種 (カーミング/ブライト/エナジー)',
      '生コラーゲン塗布',
    ],
  },
  {
    category: 'マッサージ・部位ケア',
    items: [
      'フェイスマッサージ',
      'デコルテマッサージ',
      '造顔マッサージ',
      '首ケア (角質除去＋ラジオ波＋パック)',
    ],
  },
] as const

export const TREATMENT_OPTION_ITEMS = TREATMENT_OPTION_CATEGORIES.flatMap(c => c.items)

interface Props {
  customerId: string
  existing:   string[]
  onClose:    () => void
  /** 保存成功時に呼ばれる(親側で今回の追加オプション表示・todayVisitIdを更新する想定)。 */
  onSaved:    (visitId: string, optionItems: string[]) => void
}

interface PutResponse {
  success:      boolean
  visitId?:     string
  optionItems?: unknown
  error?:       string
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string')
}

export default function TreatmentOptionEditModal({ customerId, existing, onClose, onSaved }: Props) {
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
      const res = await authedFetch(`/api/customers/${customerId}/today-treatment-course`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ optionItems: Array.from(selected) }),
      })
      const json = await res.json() as PutResponse
      if (!res.ok || !json.success || !json.visitId) {
        setError('保存に失敗しました')
        return
      }
      onSaved(json.visitId, toStringList(json.optionItems))
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
        background: PALETTE.bg, borderRadius: '16px', maxWidth: '560px', width: '100%',
        maxHeight: '85vh', overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <p style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: PALETTE.text, fontFamily: headingFont.style.fontFamily }}>
            追加オプションを選択
          </p>
          <button type="button" onClick={onClose} aria-label="閉じる" style={{ background: 'none', border: 'none', cursor: 'pointer', color: PALETTE.muted }}>
            <X size={20} />
          </button>
        </div>

        <p style={{ margin: 0, fontSize: '12px', color: PALETTE.muted, lineHeight: 1.6 }}>
          該当する項目をタップしてON/OFFしてください。複数選択できます。
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {TREATMENT_OPTION_CATEGORIES.map(({ category, items }) => (
            <div key={category} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <p style={{ margin: 0, fontSize: '12px', fontWeight: 700, color: PALETTE.gold }}>
                {category}
              </p>
              {items.map(label => {
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
          ))}
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
