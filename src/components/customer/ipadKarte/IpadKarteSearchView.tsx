'use client'
/**
 * IpadKarteSearchView.tsx — iPadカルテ「検索→一覧→選択」画面(PHASE IPAD-2)。
 *
 * CustomerBottomSheetを経由せず、名前・担当スタッフ名で顧客を検索してIpadStaffKarteViewを
 *直接開くための入口。検索対象データ・フィルタ方式は既存の顧客タブ(CustomersScreen.tsx)と
 * 同じuseCustomerStore(グローバルstate、新規APIなし)・同じ文字列部分一致パターンを流用する
 * (READ ONLY調査2026-09-11で確認済み: 電話番号は検索対象データが実質存在しないため対象外、
 * 名前・担当スタッフ名のみに絞る)。
 *
 * CustomerBottomSheet.tsx・IpadStaffKarteView.tsx本体には一切手を入れず、customerId/
 * customerNameのみを渡す自己完結コンポーネント(CustomerModeView/IpadStaffKarteViewと同じ設計方針)。
 */
import { useEffect, useState } from 'react'
import { Flower2, Search, X } from 'lucide-react'
import { useCustomerStore, type CustomerRow } from '@/store/useCustomerStore'
import { PALETTE, headingFont } from '@/components/customer/shared/PhotoCompareKit'
import IpadStaffKarteView from './IpadStaffKarteView'

interface Props {
  onClose: () => void
}

export default function IpadKarteSearchView({ onClose }: Props) {
  const { customers, isLoading, fetchCustomers } = useCustomerStore()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<CustomerRow | null>(null)

  useEffect(() => { void fetchCustomers() }, [fetchCustomers])

  if (selected) {
    return (
      <IpadStaffKarteView
        customerId={selected.id}
        customerName={selected.name}
        onClose={() => setSelected(null)}
      />
    )
  }

  const q = query.trim().toLowerCase()
  const filtered = q
    ? customers.filter(c => c.name.toLowerCase().includes(q) || c.staffName.toLowerCase().includes(q))
    : customers

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: PALETTE.bg, display: 'flex', flexDirection: 'column' }}>
      {/* ── ヘッダー ── */}
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
          padding: 'max(20px, calc(env(safe-area-inset-top) + 14px)) 28px 16px',
          background: PALETTE.bg,
          borderBottom: `1px solid ${PALETTE.border}`,
        }}
      >
        <p
          style={{
            margin: 0, display: 'flex', alignItems: 'center', gap: '6px',
            fontSize: '20px', color: PALETTE.gold, letterSpacing: '0.01em',
            fontFamily: headingFont.style.fontFamily,
          }}
        >
          <Flower2 size={16} strokeWidth={1.4} color={PALETTE.gold} />
          Salon Riora
          <span style={{ fontSize: '11px', color: PALETTE.muted, marginLeft: '8px', fontWeight: 400 }}>
            iPadカルテ検索
          </span>
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="カルテ検索を閉じる"
          style={{
            width: '44px', height: '44px', borderRadius: '50%', flexShrink: 0,
            background: PALETTE.card, border: `1.5px solid ${PALETTE.gold}`, color: PALETTE.text,
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          }}
        >
          <X size={20} strokeWidth={2.2} />
        </button>
      </div>

      {/* ── 検索窓 ── */}
      <div style={{ flexShrink: 0, padding: '18px 28px 8px' }}>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            maxWidth: '560px', margin: '0 auto',
            background: PALETTE.card, border: `1px solid ${PALETTE.border}`, borderRadius: '999px',
            padding: '12px 20px', boxShadow: PALETTE.shadow,
          }}
        >
          <Search size={16} color={PALETTE.gold} strokeWidth={1.8} />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="お客様の名前・担当スタッフ名で検索…"
            autoFocus
            style={{
              flex: 1, border: 'none', outline: 'none', background: 'transparent',
              fontSize: '15px', color: PALETTE.text,
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="クリア"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: PALETTE.muted, display: 'flex' }}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* ── 一覧 ── */}
      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '12px 28px 32px' }}>
        <div style={{ maxWidth: '560px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {isLoading && (
            <p style={{ textAlign: 'center', color: PALETTE.muted, fontSize: '13px', padding: '32px 0' }}>
              読み込み中…
            </p>
          )}

          {!isLoading && filtered.length === 0 && (
            <p style={{ textAlign: 'center', color: PALETTE.muted, fontSize: '13px', padding: '32px 0' }}>
              該当する顧客が見つかりません
            </p>
          )}

          {!isLoading && filtered.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelected(c)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
                width: '100%', textAlign: 'left', cursor: 'pointer',
                background: PALETTE.card, border: `1px solid ${PALETTE.border}`, borderRadius: '16px',
                padding: '14px 18px', boxShadow: PALETTE.shadow,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: PALETTE.text }}>
                  {c.name} 様
                </p>
                <p style={{ margin: '3px 0 0', fontSize: '12px', color: PALETTE.muted }}>
                  {c.staffName ? `担当: ${c.staffName}` : '担当: 未設定'}
                </p>
              </div>
              <span style={{ color: PALETTE.gold, fontSize: '16px', flexShrink: 0 }}>›</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
