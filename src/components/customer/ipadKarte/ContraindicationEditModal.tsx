'use client'
/**
 * ContraindicationEditModal.tsx — 「重要事項」の手動登録・編集モーダル
 * (2026-09-28ユーザー承認)。
 *
 * `/karte`のPIN保護スタッフモード(IpadStaffKarteView.tsx)専用。スマホアプリ
 * (CustomerBottomSheet.tsx、customer_notes/voice_notesのキーワード自動検出)に
 * 依存せず、既存16ルール(CONTRAINDICATION_RULES)のチェックボックスON/OFFで
 * 直接 contraindications テーブルへ書き込み・削除する。自由記述メモは
 * customer_notesへの手動メモとして保存するのみ(チェックボックスとは役割を分離、
 * このメモからの自動キーワード再解析は行わない)。
 *
 * チェックボックスのON/OFFは「そのtitleの行が今存在するか」だけを見る。生成元が
 * AI自動検出(customer_notes/voice_notes)か手動かを問わず、OFFにすれば削除される
 * (既存のCustomerBottomSheet.tsx側の削除ボタンと同じ「生成元を問わず削除可能」という
 * 既存仕様を踏襲。新たな制約は設けていない)。
 */
import { useState } from 'react'
import { X, Check } from 'lucide-react'
import { authedFetch } from '@/lib/api/authedFetch'
import { PALETTE, headingFont } from '@/components/customer/shared/PhotoCompareKit'
import { CONTRAINDICATION_RULES } from '@/lib/contraindication'
import { CONTRAINDICATION_SEVERITY_LABEL, CONTRAINDICATION_SEVERITY_COLOR } from '@/types'
import type { Contraindication } from '@/types'

interface Props {
  customerId: string
  existing:   Contraindication[]
  onClose:    () => void
  /** 保存成功時に呼ばれる(親側で表示中の重要事項一覧を再取得させる想定)。 */
  onSaved:    () => void
}

interface PutResponse {
  success: boolean
  error?:  string
}

export default function ContraindicationEditModal({ customerId, existing, onClose, onSaved }: Props) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(existing.map(c => c.title).filter(t => CONTRAINDICATION_RULES.some(r => r.title === t)))
  )
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggle(title: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(title)) next.delete(title)
      else next.add(title)
      return next
    })
  }

  async function handleSave() {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await authedFetch(`/api/customers/${customerId}/contraindications-manual`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ selectedTitles: Array.from(selected), note: note.trim() || null }),
      })
      const json = await res.json() as PutResponse
      if (!res.ok || !json.success) {
        setError('保存に失敗しました')
        return
      }
      onSaved()
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
            重要事項を編集
          </p>
          <button type="button" onClick={onClose} aria-label="閉じる" style={{ background: 'none', border: 'none', cursor: 'pointer', color: PALETTE.muted }}>
            <X size={20} />
          </button>
        </div>

        <p style={{ margin: 0, fontSize: '12px', color: PALETTE.muted, lineHeight: 1.6 }}>
          該当する項目をタップしてON/OFFしてください。ONにした項目は画面上部の重要事項に
          即座に反映されます。
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {CONTRAINDICATION_RULES.map(rule => {
            const isOn = selected.has(rule.title)
            const col = CONTRAINDICATION_SEVERITY_COLOR[rule.severity]
            return (
              <button
                key={rule.title}
                type="button"
                onClick={() => toggle(rule.title)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px', textAlign: 'left',
                  padding: '10px 12px', borderRadius: '12px', cursor: 'pointer',
                  border: `1.5px solid ${isOn ? col.border : PALETTE.border}`,
                  background: isOn ? col.bg : 'none',
                }}
              >
                <span style={{
                  flexShrink: 0, width: '20px', height: '20px', borderRadius: '6px',
                  border: `1.5px solid ${isOn ? col.text : PALETTE.muted}`,
                  background: isOn ? col.text : 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {isOn && <Check size={13} color="#fff" strokeWidth={3} />}
                </span>
                <span style={{ flex: 1, fontSize: '13px', fontWeight: 600, color: isOn ? col.text : PALETTE.text }}>
                  {rule.title}
                </span>
                <span style={{
                  fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px',
                  color: col.text, background: col.bg, border: `1px solid ${col.border}`, flexShrink: 0,
                }}>
                  {CONTRAINDICATION_SEVERITY_LABEL[rule.severity]}
                </span>
              </button>
            )
          })}
        </div>

        <div>
          <p style={{ margin: '0 0 6px', fontSize: '12px', color: PALETTE.muted }}>
            顧客メモに追記する内容(任意)
          </p>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="上記に当てはまらない注意事項があれば記録してください"
            rows={4}
            style={{
              width: '100%', boxSizing: 'border-box', resize: 'vertical', minHeight: '90px',
              fontSize: '13px', color: PALETTE.text, lineHeight: 1.6,
              border: `1px solid ${PALETTE.border}`, borderRadius: '8px', padding: '10px',
              outline: 'none', fontFamily: 'inherit',
            }}
          />
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
