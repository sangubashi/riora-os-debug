'use client'
/**
 * KarteCustomerSwitcher.tsx — `/karte/[customerId]`の本体(PHASE IPAD-KARTE-ENTRY-1・
 * 2026-09-20ユーザー承認)。
 *
 * CustomerBottomSheetは再利用せず、GET /api/customers/[id]で顧客を直接取得する
 * (ブックマーク・リロード・URL直打ちに対応するため、一覧の再利用に依存しない)。
 * 常にお客様用カルテ(CustomerModeView)から開始し、そのヘッダーロゴの長押しで
 * スタッフ用カルテ(IpadStaffKarteView)へ切り替える(2択ランディングは無し)。
 * CustomerModeView/IpadStaffKarteView自体のロジック・見た目は変更せず、
 * 今回追加した任意propsのみで結合する。
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { authedFetch } from '@/lib/api/authedFetch'
import { PALETTE } from '@/components/customer/shared/PhotoCompareKit'
import CustomerModeView from '@/components/customer/guestMode/CustomerModeView'
import IpadStaffKarteView from '@/components/customer/ipadKarte/IpadStaffKarteView'
import CustomerTopPage from '@/components/customer/CustomerTopPage'
import type { Customer as BSCustomer } from '@/types'

interface CustomerDetail {
  id: string
  name: string
}

// お客様トップページ(CustomerTopPage.tsx)への導線(2026-09-28ユーザー承認)。
// CustomerTopPageはid/nameのみを実際に使用するため(他の必須フィールドは内部で
// 別途API取得しており、propsとしては読まない)、他のフィールドはダミー値で埋める
// (KarteEntryScreen.tsxのtoCustomerFromRow等と同じ「最小マッパーを複製する」既存パターン)。
function toMinimalCustomerForTopPage(customer: CustomerDetail): BSCustomer {
  return {
    id:                    customer.id,
    name:                  customer.name,
    visits:                0,
    visit_count:           0,
    total_sales:           0,
    avg_price:             0,
    last_visit:            '',
    customer_type:         '信頼構築型',
    vip_rank:              1,
    churn_risk:            0,
    line_response_rate:    0,
    next_visit_prediction: '',
  }
}

interface CustomerDetailApiResponse {
  success: boolean
  customer?: { id: string; name: string }
  error?: string
}

type SwitcherMode = 'customer' | 'staff'

export default function KarteCustomerSwitcher({ customerId }: { customerId: string }) {
  const router = useRouter()
  const [customer, setCustomer] = useState<CustomerDetail | null>(null)
  const [error, setError] = useState<'forbidden' | 'not_found' | null>(null)
  const [mode, setMode] = useState<SwitcherMode>('customer')
  // PERF-KARTE-SWITCH-CACHE-1(2026-09-21): 長押し切り替えのたびにIpadStaffKarteViewを
  // アンマウント/リマウントすると、内部のuseIpadKarteData等が同じ顧客のデータを毎回
  // 取り直してしまう(調査報告の根本原因①)。これを避けるため、スタッフ用カルテは
  // 初回切り替え時に一度だけマウントし、以降は顧客が変わるまでアンマウントせず
  // display:noneで隠すだけにする(お客様用カルテは元々常時マウントのまま、切り替えは
  // CSS表示のみに変更)。初回表示時(お客様用カルテのみ表示中)はスタッフ用カルテの
  // データ取得が一切走らないよう、mountするまでコンポーネント自体をレンダーしない。
  const [staffViewMounted, setStaffViewMounted] = useState(false)
  // お客様トップページ(CustomerTopPage.tsx)への導線(2026-09-28ユーザー承認)。
  const [showCustomerTop, setShowCustomerTop] = useState(false)

  useEffect(() => {
    let cancelled = false
    setCustomer(null)
    setError(null)
    setMode('customer')
    setStaffViewMounted(false)
    setShowCustomerTop(false)

    void (async () => {
      const res = await authedFetch(`/api/customers/${customerId}`)
      if (cancelled) return
      if (!res.ok) {
        setError(res.status === 403 ? 'forbidden' : 'not_found')
        return
      }
      const body = (await res.json()) as CustomerDetailApiResponse
      if (!body.success || !body.customer) {
        setError('not_found')
        return
      }
      setCustomer({ id: body.customer.id, name: body.customer.name })
    })()

    return () => { cancelled = true }
  }, [customerId])

  const backToKarte = () => router.push('/karte')

  if (error) {
    return (
      <div
        style={{
          height: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', gap: '14px', background: PALETTE.bg, padding: '24px',
        }}
      >
        <p style={{ fontSize: '14px', color: PALETTE.muted, textAlign: 'center' }}>
          {error === 'forbidden' ? 'この顧客のカルテを表示する権限がありません。' : '顧客が見つかりませんでした。'}
        </p>
        <button
          type="button"
          onClick={backToKarte}
          style={{
            padding: '10px 22px', borderRadius: '999px', border: `1.5px solid ${PALETTE.gold}`,
            background: 'none', color: PALETTE.gold, fontSize: '13px', fontWeight: 700, cursor: 'pointer',
          }}
        >
          /karte へ戻る
        </button>
      </div>
    )
  }

  if (!customer) {
    return (
      <div style={{ height: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: PALETTE.bg }}>
        <p style={{ fontSize: '13px', color: PALETTE.muted }}>読み込み中…</p>
      </div>
    )
  }

  return (
    <>
      <div style={{ display: mode === 'customer' ? 'contents' : 'none' }}>
        <CustomerModeView
          customerId={customer.id}
          customerName={customer.name}
          onClose={backToKarte}
          onSwitchToStaffView={() => { setStaffViewMounted(true); setMode('staff') }}
          onShowCustomerTop={() => setShowCustomerTop(true)}
        />
      </div>
      {staffViewMounted && (
        <div style={{ display: mode === 'staff' ? 'contents' : 'none' }}>
          <IpadStaffKarteView
            customerId={customer.id}
            customerName={customer.name}
            onClose={backToKarte}
            onSwitchToCustomerView={() => setMode('customer')}
            onShowCustomerTop={() => setShowCustomerTop(true)}
          />
        </div>
      )}
      {showCustomerTop && (
        <CustomerTopPage
          customer={toMinimalCustomerForTopPage(customer)}
          onClose={() => setShowCustomerTop(false)}
          // 画面フリーズ修正(2026-09-28ユーザー承認): 既にこの顧客の詳細ページ
          // (/karte/[customerId])に居るため、「詳細ページを見る」は実際に遷移させず
          // オーバーレイを閉じるだけでよい(router.pushに任せると同一ルートへのpushが
          // no-opになり、オーバーレイが開いたまま操作不能になっていた)。
          onGoToDetail={() => setShowCustomerTop(false)}
        />
      )}
    </>
  )
}
