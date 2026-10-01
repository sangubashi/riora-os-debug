'use client'
/**
 * DeleteConfirmDialog.tsx — カルテメモ削除前の確認モーダル(2026-10-01ユーザー依頼)。
 *
 * KarteMemoSection.tsx(カルテメモ一覧)・VisitHistorySection.tsx(来店日別メモ)・
 * PastVisitMemoEditModal.tsx(過去来店の自由記述メモ編集)の3箇所で共用する。
 * window.confirmは使わない(iPad Safariでのダイアログ起因のフリーズ回避・見た目統一のため)。
 * 親側は「削除する」押下時にonConfirmを実行し、成功時にこのダイアログを閉じる(error表示のみ本部品が担う)。
 */
import { PALETTE } from '@/components/customer/shared/PhotoCompareKit'

interface Props {
  title:      string
  message:    string
  deleting:   boolean
  error:      boolean
  onConfirm:  () => void
  onCancel:   () => void
}

export default function DeleteConfirmDialog({ title, message, deleting, error, onConfirm, onCancel }: Props) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={() => { if (!deleting) onCancel() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 600, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: '380px', background: PALETTE.card, borderRadius: '14px',
          padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px',
        }}
      >
        <p style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: PALETTE.text, lineHeight: 1.6 }}>{title}</p>
        <p style={{ margin: 0, fontSize: '12px', color: PALETTE.muted, lineHeight: 1.6 }}>{message}</p>
        {error && (
          <p style={{ margin: 0, fontSize: '12px', color: '#B85050' }}>削除できませんでした。もう一度お試しください。</p>
        )}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            style={{
              fontSize: '13px', padding: '8px 16px', borderRadius: '999px',
              border: `1px solid ${PALETTE.border}`, background: PALETTE.card, color: PALETTE.muted,
              cursor: deleting ? 'default' : 'pointer',
            }}
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            style={{
              fontSize: '13px', fontWeight: 700, padding: '8px 16px', borderRadius: '999px',
              border: 'none', background: deleting ? PALETTE.border : '#B85050', color: '#fff',
              cursor: deleting ? 'default' : 'pointer',
            }}
          >
            {deleting ? '削除中…' : '削除する'}
          </button>
        </div>
      </div>
    </div>
  )
}
