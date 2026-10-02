'use client'
/**
 * ContractsSection.tsx — 顧客トップページの「契約書・申込書」(作成導線+履歴、2026-10-02)。
 *
 * 履歴は保存済みPDFの一覧(新しい順)。保存後は編集不可・削除機能なし(今回は作らない)。
 * 作成ボタンから ContractWizard を開く。店舗共通ログイン時は、選択済みの担当者(担当者タグ)を
 * created_by として保存に渡す(個人ログイン時は無視される)。
 */
import { useCallback, useEffect, useState } from 'react'
import { FilePlus2, FileText, ShieldAlert } from 'lucide-react'
import { PALETTE, headingFont } from '@/components/customer/shared/PhotoCompareKit'
import { CONTRACT_DOCUMENT_TYPE_LABEL } from '@/lib/contracts/contractTemplates'
import { listContracts, type ContractSummary } from '@/lib/contracts/contractsApiClient'
import { useAuthStore } from '@/store/useAuthStore'
import { SHARED_IPAD_STAFF_USER_ID } from '@/lib/constants'
import { useStaffTagSession } from '@/lib/staffTag/useStaffTagSession'
import ContractWizard from './ContractWizard'

const formatDate = (iso: string) => iso.replace(/-/g, '/')
const formatYen = (n: number) => `${n.toLocaleString('ja-JP')}円`

export default function ContractsSection({ customerId, cardStyle }: { customerId: string; cardStyle: React.CSSProperties }) {
  const [contracts, setContracts] = useState<ContractSummary[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [open, setOpen] = useState(false)

  const isSharedLogin = useAuthStore(s => s.user?.id) === SHARED_IPAD_STAFF_USER_ID
  const staffTag = useStaffTagSession(isSharedLogin)

  const load = useCallback(async () => {
    try {
      setContracts(await listContracts(customerId))
      setLoadError(false)
    } catch {
      setLoadError(true)
    }
  }, [customerId])

  useEffect(() => { void load() }, [load])

  return (
    <div data-testid="contracts-section" style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
        <p style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: PALETTE.text, fontFamily: headingFont.style.fontFamily }}>
          契約書・申込書
        </p>
        <button
          type="button" data-testid="contract-create" onClick={() => setOpen(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 16px', borderRadius: '999px',
            border: `1.5px solid ${PALETTE.gold}`, background: 'none', color: PALETTE.gold,
            fontSize: '13px', fontWeight: 700, cursor: 'pointer',
          }}
        >
          <FilePlus2 size={16} />契約書・申込書を作成
        </button>
      </div>

      {contracts === null && !loadError && <p style={{ margin: 0, fontSize: '13px', color: PALETTE.muted }}>読み込み中…</p>}
      {loadError && <p style={{ margin: 0, fontSize: '13px', color: '#b3402e' }}>履歴を読み込めませんでした</p>}
      {contracts?.length === 0 && <p style={{ margin: 0, fontSize: '13px', color: PALETTE.muted }}>保存された契約書・申込書はありません</p>}

      {contracts && contracts.length > 0 && (
        <ul data-testid="contract-history" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {contracts.map(c => (
            <li
              key={c.id} data-testid={`contract-row-${c.id}`}
              style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', borderRadius: '12px', border: `1px solid ${PALETTE.border}`, background: PALETTE.card }}
            >
              <FileText size={20} color={PALETTE.gold} style={{ flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: '12px', color: PALETTE.muted }}>{formatDate(c.applicationDate)}</p>
                <p style={{ margin: '2px 0 0', fontSize: '14px', fontWeight: 700, color: PALETTE.text }}>{CONTRACT_DOCUMENT_TYPE_LABEL[c.documentType]}</p>
                <p style={{ margin: '2px 0 0', fontSize: '13px', color: PALETTE.text }}>{formatYen(c.totalAmount)}</p>
                {c.integrityOk === false && (
                  <p style={{ margin: '4px 0 0', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#b3402e' }}>
                    <ShieldAlert size={12} />保存時から内容が変わっている可能性があります
                  </p>
                )}
              </div>
              {c.pdfUrl ? (
                <a
                  href={c.pdfUrl} target="_blank" rel="noopener noreferrer"
                  style={{ flexShrink: 0, padding: '8px 14px', borderRadius: '999px', background: PALETTE.gold, color: '#fff', fontSize: '13px', fontWeight: 700, textDecoration: 'none' }}
                >
                  PDFを見る
                </a>
              ) : <span style={{ fontSize: '11px', color: PALETTE.muted }}>PDFを取得できません</span>}
            </li>
          ))}
        </ul>
      )}

      {open && (
        <ContractWizard
          customerId={customerId}
          staffId={isSharedLogin ? staffTag.tag?.id ?? null : null}
          onClose={() => setOpen(false)}
          onSaved={() => { void load() }}
        />
      )}
    </div>
  )
}
