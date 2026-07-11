'use client'
/**
 * MenuMasterScreen.tsx — メニューマスタ管理画面(brain_menus CRUD・管理者専用)
 *
 * 設計根拠: docs/MENU_MASTER_IMPLEMENTATION_PLAN.md / docs/MENU_MASTER_IMPLEMENTATION_REVIEW.md
 *
 * 重要: MD-5稼働率分析とは接続しない(OccupancyRepoはreservations.duration_minutes
 * を使用しており既に実装済みのため無関係)。本画面のスコープはメニューマスタの
 * 登録・編集・削除に限定する。
 *
 * role='imported_other'の行(CSV突合エンジンのフォールバック専用)は編集・削除ボタンを
 * 無効化する(API層でも二重にガード済み)。
 */
import { useEffect, useState } from 'react'
import { Loader2, Plus, Pencil, Trash2, Lock } from 'lucide-react'
import { useMenuMasterStore, type MenuMasterRow, type MenuMutationInput } from '@/store/useMenuMasterStore'
import type { MenuRole, CustomerType } from '@/types/riora.types'
import { EDITABLE_MENU_ROLES, ALL_CUSTOMER_TYPES } from '@/lib/menu/menuMasterConstants'
import { DEMO_STORE_ID } from '@/lib/constants'

const ROLE_LABELS: Record<MenuRole, string> = {
  entry: 'エントリー',
  pore: '毛穴ケア',
  sensitive: '低刺激',
  peeling: 'ピーリング',
  lifting: 'リフトアップ',
  imported_other: 'CSV未マッチ(保護対象)',
}

const CUSTOMER_TYPE_LABELS: Record<CustomerType, string> = {
  A_acne: 'A_acne(ニキビ)',
  B_pore: 'B_pore(毛穴)',
  C_sensitive: 'C_sensitive(敏感肌)',
  D_aging: 'D_aging(エイジング)',
  E_bridal: 'E_bridal(ブライダル)',
}

function formatYen(n: number): string {
  return `¥${n.toLocaleString('ja-JP')}`
}

const EMPTY_FORM: MenuMutationInput = { name: '', price: 0, role: 'entry', targetTypes: [] }

interface MenuFormModalProps {
  title: string
  initial: MenuMutationInput
  submitLabel: string
  onCancel: () => void
  onSubmit: (input: MenuMutationInput) => Promise<{ success: boolean; error?: string }>
}

function MenuFormModal({ title, initial, submitLabel, onCancel, onSubmit }: MenuFormModalProps) {
  const [form, setForm] = useState<MenuMutationInput>(initial)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggleTargetType = (t: CustomerType) => {
    setForm((f) => ({
      ...f,
      targetTypes: f.targetTypes.includes(t) ? f.targetTypes.filter((x) => x !== t) : [...f.targetTypes, t],
    }))
  }

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      setError('メニュー名を入力してください')
      return
    }
    if (form.price < 0) {
      setError('金額は0以上で入力してください')
      return
    }
    setIsSubmitting(true)
    setError(null)
    const result = await onSubmit(form)
    setIsSubmitting(false)
    if (!result.success) {
      setError(result.error ?? '保存に失敗しました')
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(92,64,51,0.35)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div style={{ background: '#fff', borderRadius: '16px', padding: '20px', width: '100%', maxWidth: '420px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#5C4033' }}>{title}</h2>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '12px', color: '#9F7E6C' }}>メニュー名</span>
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            style={{ border: '1px solid #F5EEF0', borderRadius: '10px', padding: '8px 10px', fontSize: '14px' }}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '12px', color: '#9F7E6C' }}>金額(円)</span>
          <input
            type="number"
            min={0}
            value={form.price}
            onChange={(e) => setForm((f) => ({ ...f, price: Number(e.target.value) }))}
            style={{ border: '1px solid #F5EEF0', borderRadius: '10px', padding: '8px 10px', fontSize: '14px' }}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '12px', color: '#9F7E6C' }}>role</span>
          <select
            value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as Exclude<MenuRole, 'imported_other'> }))}
            style={{ border: '1px solid #F5EEF0', borderRadius: '10px', padding: '8px 10px', fontSize: '14px' }}
          >
            {EDITABLE_MENU_ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
        </label>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span style={{ fontSize: '12px', color: '#9F7E6C' }}>target_types</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {ALL_CUSTOMER_TYPES.map((t) => {
              const checked = form.targetTypes.includes(t)
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleTargetType(t)}
                  style={{
                    fontSize: '11px', padding: '5px 10px', borderRadius: '999px', cursor: 'pointer',
                    border: checked ? '1px solid #D98292' : '1px solid #F5EEF0',
                    background: checked ? '#FDEEF1' : '#fff',
                    color: checked ? '#D98292' : '#9F7E6C',
                  }}
                >
                  {CUSTOMER_TYPE_LABELS[t]}
                </button>
              )
            })}
          </div>
        </div>

        {error && <p style={{ fontSize: '12px', color: '#D14F4F' }}>{error}</p>}

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' }}>
          <button
            onClick={onCancel}
            disabled={isSubmitting}
            style={{ fontSize: '13px', fontWeight: 600, padding: '9px 16px', borderRadius: '10px', border: '1px solid #F5EEF0', background: '#fff', color: '#9F7E6C', cursor: 'pointer' }}
          >
            キャンセル
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            style={{ fontSize: '13px', fontWeight: 700, padding: '9px 16px', borderRadius: '10px', border: 'none', background: '#D98292', color: '#fff', cursor: 'pointer' }}
          >
            {isSubmitting ? '保存中...' : submitLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function MenuRow({ menu, onEdit, onDeleted }: { menu: MenuMasterRow; onEdit: (menu: MenuMasterRow) => void; onDeleted: () => void }) {
  const { deleteMenu } = useMenuMasterStore()
  const [confirming, setConfirming] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const isProtected = menu.role === 'imported_other'

  const handleDelete = async () => {
    setIsDeleting(true)
    setDeleteError(null)
    const result = await deleteMenu(menu.id)
    setIsDeleting(false)
    if (!result.success) {
      if (result.error === 'menu_in_use') {
        setDeleteError(`${result.usageCount ?? ''}件の来店履歴が紐づいているため削除できません`)
      } else if (result.error === 'imported_other_protected') {
        setDeleteError('このメニューは削除できません(CSV突合エンジンの保護対象)')
      } else {
        setDeleteError(result.error ?? '削除に失敗しました')
      }
      setConfirming(false)
      return
    }
    onDeleted()
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #F5EEF0', borderRadius: '16px', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <div>
          <p style={{ fontSize: '14px', fontWeight: 700, color: '#5C4033' }}>{menu.name}</p>
          <p style={{ fontSize: '13px', color: '#9F7E6C' }}>{formatYen(menu.price)} ・ {ROLE_LABELS[menu.role]}</p>
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {isProtected ? (
            <span title="編集・削除不可(保護対象)" style={{ color: '#C8A8B0', display: 'flex' }}>
              <Lock size={16} />
            </span>
          ) : (
            <>
              <button
                onClick={() => onEdit(menu)}
                aria-label="編集"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#78A8D8', display: 'flex' }}
              >
                <Pencil size={16} />
              </button>
              <button
                onClick={() => setConfirming(true)}
                aria-label="削除"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#D14F4F', display: 'flex' }}
              >
                <Trash2 size={16} />
              </button>
            </>
          )}
        </div>
      </div>

      {menu.targetTypes.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {menu.targetTypes.map((t) => (
            <span key={t} style={{ fontSize: '10px', padding: '3px 8px', borderRadius: '999px', background: '#FDEEF1', color: '#D98292' }}>
              {t}
            </span>
          ))}
        </div>
      )}

      {confirming && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#FFF8F7', borderRadius: '10px', padding: '8px 10px' }}>
          <span style={{ fontSize: '12px', color: '#5C4033', flex: 1 }}>本当に削除しますか?</span>
          <button
            onClick={handleDelete}
            disabled={isDeleting}
            style={{ fontSize: '12px', fontWeight: 700, padding: '6px 12px', borderRadius: '8px', border: 'none', background: '#D14F4F', color: '#fff', cursor: 'pointer' }}
          >
            {isDeleting ? '削除中...' : '削除する'}
          </button>
          <button
            onClick={() => setConfirming(false)}
            disabled={isDeleting}
            style={{ fontSize: '12px', fontWeight: 600, padding: '6px 12px', borderRadius: '8px', border: '1px solid #F5EEF0', background: '#fff', color: '#9F7E6C', cursor: 'pointer' }}
          >
            キャンセル
          </button>
        </div>
      )}

      {deleteError && <p style={{ fontSize: '12px', color: '#D14F4F' }}>{deleteError}</p>}
    </div>
  )
}

export default function MenuMasterScreen() {
  const { menus, isLoading, error, fetchMenus, createMenu, updateMenu } = useMenuMasterStore()
  const [modalMode, setModalMode] = useState<'none' | 'create' | 'edit'>('none')
  const [editingMenu, setEditingMenu] = useState<MenuMasterRow | null>(null)

  useEffect(() => {
    fetchMenus(DEMO_STORE_ID)
  }, [fetchMenus])

  const openCreate = () => {
    setEditingMenu(null)
    setModalMode('create')
  }
  const openEdit = (menu: MenuMasterRow) => {
    setEditingMenu(menu)
    setModalMode('edit')
  }
  const closeModal = () => {
    setModalMode('none')
    setEditingMenu(null)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '16px', maxWidth: '480px' }}>
      <div>
        <p style={{ fontSize: '10px', fontWeight: 700, color: '#C8A8B0', letterSpacing: '0.1em', marginBottom: '2px' }}>
          メニューマスタ管理
        </p>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          <h1 style={{ fontSize: '18px', fontWeight: 700, color: '#5C4033' }}>メニュー管理</h1>
          <button
            onClick={openCreate}
            style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', fontWeight: 700, padding: '8px 14px', borderRadius: '10px', border: 'none', background: '#D98292', color: '#fff', cursor: 'pointer' }}
          >
            <Plus size={14} /> 新規メニュー
          </button>
        </div>
        <p style={{ fontSize: '12px', color: '#9F7E6C', marginTop: '4px' }}>
          「CSV未マッチ(保護対象)」行は編集・削除できません。来店履歴が紐づくメニューも削除できません。
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
          メニュー一覧の取得に失敗しました: {error}
        </div>
      )}

      {!isLoading && !error && menus.length === 0 && (
        <div style={{ padding: '40px 0', textAlign: 'center', color: '#C8A8B0', fontSize: '13px' }}>
          メニューが登録されていません
        </div>
      )}

      {!isLoading && menus.map((menu) => (
        <MenuRow key={menu.id} menu={menu} onEdit={openEdit} onDeleted={() => {}} />
      ))}

      {modalMode === 'create' && (
        <MenuFormModal
          title="新規メニュー"
          initial={EMPTY_FORM}
          submitLabel="作成する"
          onCancel={closeModal}
          onSubmit={async (input) => {
            const result = await createMenu(DEMO_STORE_ID, input)
            if (result.success) closeModal()
            return result
          }}
        />
      )}

      {modalMode === 'edit' && editingMenu && (
        <MenuFormModal
          title="メニューを編集"
          initial={{
            name: editingMenu.name,
            price: editingMenu.price,
            role: editingMenu.role as Exclude<MenuRole, 'imported_other'>,
            targetTypes: editingMenu.targetTypes,
          }}
          submitLabel="保存する"
          onCancel={closeModal}
          onSubmit={async (input) => {
            const result = await updateMenu(editingMenu.id, input)
            if (result.success) closeModal()
            return result
          }}
        />
      )}
    </div>
  )
}
