'use client'
/**
 * SalonBoardImportModal.tsx — 「サロンボード情報を取り込む」モーダル(2026-09-24ユーザー承認)。
 *
 * SalonBoard「お客様情報詳細」ページのテキストをそのまま貼り付けて、既存顧客
 * (このモーダルの呼び出し元で選択中の顧客)の生年月日・フリガナ・電話番号・性別・
 * 初回来店日・来店回数・来店きっかけを一括更新する。新規顧客の作成は対象外
 * (既存顧客への情報補完のみ)。パース・DB更新はサーバー側
 * (PATCH /api/customers/[id]/import-salonboard-text)で行い、このモーダルは
 * 貼り付けUIと結果表示のみを担う。
 *
 * 電話番号は個人情報方針の例外化(2026-09-24ユーザー承認)により取り込む。
 * このモーダル自体はPIN保護されたスタッフモード(IpadStaffKarteView.tsx)からのみ
 * 呼び出す運用のため、電話番号を含む結果表示をそのままここに出す。
 * 「はがき送付許諾」「メッセージ配信先情報」は取込対象から除外済み(不要項目)。
 */
import { useState } from 'react'
import { X, ClipboardPaste, Check } from 'lucide-react'
import { authedFetch } from '@/lib/api/authedFetch'
import { PALETTE, headingFont } from '@/components/customer/shared/PhotoCompareKit'

interface Props {
  customerId: string
  onClose:    () => void
  /** 取込成功時に呼ばれる(親側で表示中の生年月日・年齢等を再取得させる想定)。 */
  onImported: () => void
}

interface ImportResponse {
  success:            boolean
  detectedName?:      string | null
  birthDate?:         string | null
  age?:               number | null
  nameKana?:          string | null
  phoneNumber?:       string | null
  gender?:            string | null
  firstVisitDate?:    string | null
  visitCount?:        number | null
  acquisitionChannel?: string | null
  error?:             string
}

export default function SalonBoardImportModal({ customerId, onClose, onImported }: Props) {
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResponse | null>(null)

  async function handleImport() {
    if (!text.trim() || saving) return
    setSaving(true)
    setError(null)
    setResult(null)
    try {
      const res = await authedFetch(`/api/customers/${customerId}/import-salonboard-text`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const json = await res.json() as ImportResponse
      if (!res.ok || !json.success) {
        setError(json.error === 'no_recognizable_fields'
          ? 'この文章から読み取れる項目がありませんでした(誕生日・電話番号・性別・初回来店日・来店回数・来店きっかけのいずれか)'
          : '取込に失敗しました')
        return
      }
      setResult(json)
      onImported()
    } catch {
      setError('取込に失敗しました')
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
            サロンボード情報を取り込む
          </p>
          <button type="button" onClick={onClose} aria-label="閉じる" style={{ background: 'none', border: 'none', cursor: 'pointer', color: PALETTE.muted }}>
            <X size={20} />
          </button>
        </div>

        <p style={{ margin: 0, fontSize: '12px', color: PALETTE.muted, lineHeight: 1.6 }}>
          SalonBoardの「お客様情報詳細」ページをコピーしてそのまま貼り付けてください。
          フリガナ・誕生日・電話番号・性別・初回来店日・来店回数・来店きっかけを
          読み取って更新します。
        </p>

        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={'顧客ID:C01570635677\n氏名 (漢字)小宮山 仁美\n誕生日1997/01/28\n初回来店日2026/07/22\n来店回数7回'}
          rows={10}
          style={{
            width: '100%', boxSizing: 'border-box', resize: 'vertical', minHeight: '200px',
            fontSize: '13px', color: PALETTE.text, lineHeight: 1.6,
            border: `1px solid ${PALETTE.border}`, borderRadius: '8px', padding: '10px',
            outline: 'none', fontFamily: 'inherit',
          }}
        />

        {error && <p style={{ margin: 0, fontSize: '12px', color: '#B85050' }}>{error}</p>}

        {result && (
          <div style={{ border: `1px solid ${PALETTE.border}`, borderRadius: '10px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <p style={{ margin: 0, fontSize: '12px', fontWeight: 700, color: PALETTE.gold, display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Check size={13} />取り込みました
            </p>
            {result.detectedName && (
              <p style={{ margin: 0, fontSize: '12px', color: PALETTE.muted }}>検出した氏名: {result.detectedName}(表示確認用・保存はしません)</p>
            )}
            {result.nameKana && (
              <p style={{ margin: 0, fontSize: '12px', color: PALETTE.text }}>フリガナ: {result.nameKana}</p>
            )}
            {result.birthDate && (
              <p style={{ margin: 0, fontSize: '12px', color: PALETTE.text }}>生年月日: {result.birthDate}{result.age !== null && result.age !== undefined ? `（${result.age}歳）` : ''}</p>
            )}
            {result.phoneNumber && <p style={{ margin: 0, fontSize: '12px', color: PALETTE.text }}>電話番号: {result.phoneNumber}</p>}
            {result.gender && <p style={{ margin: 0, fontSize: '12px', color: PALETTE.text }}>性別: {result.gender}</p>}
            {result.firstVisitDate && <p style={{ margin: 0, fontSize: '12px', color: PALETTE.text }}>初回来店日: {result.firstVisitDate}</p>}
            {result.visitCount !== null && result.visitCount !== undefined && <p style={{ margin: 0, fontSize: '12px', color: PALETTE.text }}>来店回数: {result.visitCount}回</p>}
            {result.acquisitionChannel && <p style={{ margin: 0, fontSize: '12px', color: PALETTE.text }}>来店きっかけ: {result.acquisitionChannel}</p>}
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            style={{ fontSize: '13px', padding: '8px 16px', borderRadius: '999px', border: `1px solid ${PALETTE.border}`, background: 'none', color: PALETTE.muted, cursor: 'pointer' }}
          >
            {result ? '閉じる' : 'キャンセル'}
          </button>
          {!result && (
            <button
              type="button"
              onClick={() => void handleImport()}
              disabled={saving || !text.trim()}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                fontSize: '13px', fontWeight: 700, padding: '8px 18px', borderRadius: '999px',
                border: 'none', background: (saving || !text.trim()) ? PALETTE.border : PALETTE.gold, color: '#fff',
                cursor: (saving || !text.trim()) ? 'default' : 'pointer',
              }}
            >
              <ClipboardPaste size={14} />{saving ? '取込中…' : '取り込む'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
