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
 *
 * Hot Pepper Beauty自動取込機能(2026-09-22ユーザー承認): 「Hot Pepperから取込」ボタンで
 * 差分プレビュー(新規/価格変更/名称一致バックフィル/掲載終了候補)を表示し、管理者が
 * 内容を確認して「反映する」を押した時点で初めてbrain_menusへ書き込む
 * (src/lib/menu/runHotpepperMenuSync.ts、既存のCSV再分類機能と同じdryRunパターン)。
 * 新規登録メニューはrole='entry'+target_types=[](未分類)で登録され、
 * MenuRowに「⚠ 未分類」バッジを表示して手動分類を促す。
 */
import { useEffect, useState } from 'react'
import { Loader2, Plus, Pencil, Trash2, Lock, Download, AlertTriangle } from 'lucide-react'
import {
  useMenuMasterStore, type MenuMasterRow, type MenuMutationInput, type HotpepperImportReport,
} from '@/store/useMenuMasterStore'
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

      {menu.targetTypes.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {menu.targetTypes.map((t) => (
            <span key={t} style={{ fontSize: '10px', padding: '3px 8px', borderRadius: '999px', background: '#FDEEF1', color: '#D98292' }}>
              {t}
            </span>
          ))}
        </div>
      ) : !isProtected && (
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: '4px', width: 'fit-content',
          fontSize: '10px', fontWeight: 700, padding: '3px 8px', borderRadius: '999px',
          background: '#FFF3DC', color: '#B8860B',
        }}>
          <AlertTriangle size={11} /> 未分類(role/target_typesを設定してください)
        </span>
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

/** Hot Pepper Beauty自動取込機能(2026-09-22): 差分プレビュー→確認→反映のモーダル。 */
function HotpepperImportModal({ onClose, onApplied }: { onClose: () => void; onApplied: () => void }) {
  const { previewHotpepperImport, applyHotpepperImport } = useMenuMasterStore()
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<HotpepperImportReport | null>(null)
  const [applied, setApplied] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    previewHotpepperImport(DEMO_STORE_ID).then((result) => {
      if (cancelled) return
      setLoading(false)
      if (!result.success || !result.report) {
        setError(result.error ?? 'hotpepper_preview_failed')
        return
      }
      setReport(result.report)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleApply = async () => {
    setApplying(true)
    setError(null)
    const result = await applyHotpepperImport(DEMO_STORE_ID)
    setApplying(false)
    if (!result.success || !result.report) {
      setError(result.error ?? 'hotpepper_apply_failed')
      return
    }
    setReport(result.report)
    setApplied(true)
    onApplied()
  }

  const hasChanges = !!report && (
    report.newItems.length > 0 || report.priceChanges.length > 0 || report.backfills.length > 0
  )

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(92,64,51,0.35)', zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div style={{ background: '#fff', borderRadius: '16px', padding: '20px', width: '100%', maxWidth: '480px', maxHeight: '85vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#5C4033' }}>Hot Pepperから取込</h2>

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '30px 0', color: '#C8A8B0' }}>
            <Loader2 size={18} className="animate-spin" style={{ marginRight: '8px' }} />
            Hot Pepperのページを取得中...
          </div>
        )}

        {error && <p style={{ fontSize: '13px', color: '#D14F4F' }}>取得に失敗しました: {error}</p>}

        {!loading && report && (
          <>
            <p style={{ fontSize: '12px', color: '#9F7E6C' }}>
              {report.pagesFetched}ページ・{report.totalParsedItems}件を取得({new Date(report.fetchedAt).toLocaleString('ja-JP')}時点)
              {applied && <span style={{ color: '#5C9E6B', fontWeight: 700 }}>・反映済み</span>}
            </p>

            {!hasChanges && (
              <p style={{ fontSize: '13px', color: '#5C9E6B', padding: '12px 0' }}>変更はありません(登録済みメニューと一致しています)</p>
            )}

            {report.newItems.length > 0 && (
              <section>
                <p style={{ fontSize: '12px', fontWeight: 700, color: '#5C4033', marginBottom: '6px' }}>
                  新規({report.newItems.length}件)
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {report.newItems.map((item) => (
                    <div key={item.hotpepperItemId} style={{ fontSize: '12px', color: '#5C4033', background: '#FAFAFA', borderRadius: '8px', padding: '6px 10px', display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                      <span>{item.name}</span>
                      <span style={{ flexShrink: 0, color: '#9F7E6C' }}>{item.price !== null ? `¥${item.price.toLocaleString('ja-JP')}` : '価格不明(登録対象外)'}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {report.priceChanges.length > 0 && (
              <section>
                <p style={{ fontSize: '12px', fontWeight: 700, color: '#5C4033', marginBottom: '6px' }}>
                  価格変更({report.priceChanges.length}件)
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {report.priceChanges.map((c) => (
                    <div key={c.menuId} style={{ fontSize: '12px', color: '#5C4033', background: '#FAFAFA', borderRadius: '8px', padding: '6px 10px', display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                      <span>{c.name}</span>
                      <span style={{ flexShrink: 0, color: '#D98292' }}>¥{c.oldPrice.toLocaleString('ja-JP')} → ¥{c.newPrice.toLocaleString('ja-JP')}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {report.backfills.length > 0 && (
              <section>
                <p style={{ fontSize: '12px', fontWeight: 700, color: '#5C4033', marginBottom: '6px' }}>
                  既存メニューとID紐付け({report.backfills.length}件、名称一致)
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {report.backfills.map((b) => (
                    <div key={b.menuId} style={{ fontSize: '12px', color: '#5C4033', background: '#FAFAFA', borderRadius: '8px', padding: '6px 10px' }}>
                      <span>{b.name}</span>
                      {b.priceChange && (
                        <span style={{ marginLeft: '8px', color: '#D98292' }}>
                          ¥{b.priceChange.oldPrice.toLocaleString('ja-JP')} → ¥{b.priceChange.newPrice.toLocaleString('ja-JP')}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {report.possiblyDiscontinued.length > 0 && (
              <section>
                <p style={{ fontSize: '12px', fontWeight: 700, color: '#B8860B', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <AlertTriangle size={13} /> 掲載終了の可能性({report.possiblyDiscontinued.length}件、自動削除はしません)
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {report.possiblyDiscontinued.map((d) => (
                    <div key={d.menuId} style={{ fontSize: '12px', color: '#9F7E6C', background: '#FFF8F1', borderRadius: '8px', padding: '6px 10px' }}>
                      {d.name}(¥{d.price.toLocaleString('ja-JP')})
                    </div>
                  ))}
                </div>
              </section>
            )}

            {report.excludedNoPrice.length > 0 && (
              <p style={{ fontSize: '11px', color: '#C8A8B0' }}>
                ほか{report.excludedNoPrice.length}件(¥0の予約導線案内等、施術メニューではないため提案対象外)
              </p>
            )}
          </>
        )}

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' }}>
          <button
            onClick={onClose}
            disabled={applying}
            style={{ fontSize: '13px', fontWeight: 600, padding: '9px 16px', borderRadius: '10px', border: '1px solid #F5EEF0', background: '#fff', color: '#9F7E6C', cursor: 'pointer' }}
          >
            閉じる
          </button>
          {!applied && hasChanges && (
            <button
              onClick={handleApply}
              disabled={loading || applying || !report}
              style={{ fontSize: '13px', fontWeight: 700, padding: '9px 16px', borderRadius: '10px', border: 'none', background: '#D98292', color: '#fff', cursor: 'pointer' }}
            >
              {applying ? '反映中...' : '反映する'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function MenuMasterScreen() {
  const { menus, isLoading, error, fetchMenus, createMenu, updateMenu } = useMenuMasterStore()
  const [modalMode, setModalMode] = useState<'none' | 'create' | 'edit'>('none')
  const [editingMenu, setEditingMenu] = useState<MenuMasterRow | null>(null)
  const [importModalOpen, setImportModalOpen] = useState(false)

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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: '18px', fontWeight: 700, color: '#5C4033' }}>メニュー管理</h1>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setImportModalOpen(true)}
              style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', fontWeight: 700, padding: '8px 14px', borderRadius: '10px', border: '1px solid #D98292', background: '#fff', color: '#D98292', cursor: 'pointer' }}
            >
              <Download size={14} /> Hot Pepperから取込
            </button>
            <button
              onClick={openCreate}
              style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', fontWeight: 700, padding: '8px 14px', borderRadius: '10px', border: 'none', background: '#D98292', color: '#fff', cursor: 'pointer' }}
            >
              <Plus size={14} /> 新規メニュー
            </button>
          </div>
        </div>
        <p style={{ fontSize: '12px', color: '#9F7E6C', marginTop: '4px' }}>
          「CSV未マッチ(保護対象)」行は編集・削除できません。来店履歴が紐づくメニューも削除できません。
        </p>
      </div>

      {importModalOpen && (
        <HotpepperImportModal
          onClose={() => setImportModalOpen(false)}
          onApplied={() => { /* applyHotpepperImport内でストアのmenusは既に最新化済み */ }}
        />
      )}

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
