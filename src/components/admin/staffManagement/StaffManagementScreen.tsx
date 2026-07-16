'use client'
/**
 * StaffManagementScreen.tsx — スタッフ管理画面(brain_staff・退職処理専用)
 * STAFF_MANAGEMENT_PHASE1_IMPLEMENT_1
 *
 * スコープ: 一覧表示・退職処理(is_active=false)のみ。
 * 新規スタッフ追加(招待)・氏名/role編集はPhase2/3の範囲外のためここには置かない
 * (docs/STAFF_MANAGEMENT_PHASE1_AUDIT_1.md 6章の判断を踏襲)。
 */
import { useEffect, useState } from 'react'
import { Loader2, UserX } from 'lucide-react'
import { useStaffManagementStore } from '@/store/useStaffManagementStore'
import type { Staff } from '@/types/riora.types'
import { DEMO_STORE_ID } from '@/lib/constants'

function StaffRow({ staff, onDeactivated }: { staff: Staff; onDeactivated: () => void }) {
  const { deactivateStaff } = useStaffManagementStore()
  const [confirming, setConfirming] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const handleDeactivate = async () => {
    setIsSubmitting(true)
    setActionError(null)
    const result = await deactivateStaff(staff.id)
    setIsSubmitting(false)
    if (!result.success) {
      setActionError(result.error ?? '退職処理に失敗しました')
      setConfirming(false)
      return
    }
    setConfirming(false)
    onDeactivated()
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #F5EEF0', borderRadius: '16px', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <div>
          <p style={{ fontSize: '14px', fontWeight: 700, color: '#5C4033' }}>{staff.name}</p>
          <p style={{ fontSize: '12px', color: staff.isActive ? '#34A090' : '#C05060' }}>
            {staff.isActive ? '在籍中' : '退職済み'}
          </p>
        </div>
        {staff.isActive && (
          <button
            onClick={() => setConfirming(true)}
            aria-label="退職処理"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#D14F4F', display: 'flex' }}
          >
            <UserX size={16} />
          </button>
        )}
      </div>

      {confirming && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#FFF8F7', borderRadius: '10px', padding: '8px 10px' }}>
          <span style={{ fontSize: '12px', color: '#5C4033', flex: 1 }}>
            {staff.name}さんを退職処理しますか?（以後アプリにログインできなくなります）
          </span>
          <button
            onClick={handleDeactivate}
            disabled={isSubmitting}
            style={{ fontSize: '12px', fontWeight: 700, padding: '6px 12px', borderRadius: '8px', border: 'none', background: '#D14F4F', color: '#fff', cursor: 'pointer' }}
          >
            {isSubmitting ? '処理中...' : '退職処理する'}
          </button>
          <button
            onClick={() => setConfirming(false)}
            disabled={isSubmitting}
            style={{ fontSize: '12px', fontWeight: 600, padding: '6px 12px', borderRadius: '8px', border: '1px solid #F5EEF0', background: '#fff', color: '#9F7E6C', cursor: 'pointer' }}
          >
            キャンセル
          </button>
        </div>
      )}

      {actionError && <p style={{ fontSize: '12px', color: '#D14F4F' }}>{actionError}</p>}
    </div>
  )
}

export default function StaffManagementScreen() {
  const { staff, isLoading, error, fetchStaff } = useStaffManagementStore()

  useEffect(() => {
    fetchStaff(DEMO_STORE_ID)
  }, [fetchStaff])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '16px', maxWidth: '480px' }}>
      <div>
        <p style={{ fontSize: '10px', fontWeight: 700, color: '#C8A8B0', letterSpacing: '0.1em', marginBottom: '2px' }}>
          スタッフ管理
        </p>
        <h1 style={{ fontSize: '18px', fontWeight: 700, color: '#5C4033' }}>スタッフ一覧</h1>
        <p style={{ fontSize: '12px', color: '#9F7E6C', marginTop: '4px' }}>
          退職処理を行うと、そのスタッフはアプリにログインできなくなります。過去の接客記録は保持されます。
        </p>
      </div>

      {isLoading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 0', color: '#C8A8B0' }}>
          <Loader2 size={18} className="animate-spin" style={{ marginRight: '8px' }} />
          読み込み中...
        </div>
      )}

      {error && (
        <div style={{ padding: '16px', color: '#D14F4F', fontSize: '13px' }}>
          スタッフ一覧の取得に失敗しました: {error}
        </div>
      )}

      {!isLoading && !error && staff.length === 0 && (
        <div style={{ padding: '40px 0', textAlign: 'center', color: '#C8A8B0', fontSize: '13px' }}>
          スタッフが登録されていません
        </div>
      )}

      {!isLoading && staff.map((s) => (
        <StaffRow key={s.id} staff={s} onDeactivated={() => {}} />
      ))}
    </div>
  )
}
