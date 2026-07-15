'use client'
/**
 * ReservationSkippedDetailModal.tsx — 予約CSV取込履歴のスキップ理由詳細(CSV_IMPORT_HISTORY_UI_1)
 *
 * brain_ops_logs.detail.skippedDetail(行番号・顧客名・理由コード)を一覧表示するモーダル。
 * 新規テーブルは使わず、履歴取得時に渡された配列をそのまま表示するのみ(読み取り専用)。
 * スタイルはStaffAliasManager.tsxに合わせる(このディレクトリの既存モーダル)。
 */
import { motion } from 'framer-motion'
import { X, AlertTriangle } from 'lucide-react'
import type { SkippedDetailEntry } from './types'
import { SKIPPED_DETAIL_REASON_LABEL } from './types'

export default function ReservationSkippedDetailModal({
  entries,
  onClose,
}: {
  entries: SkippedDetailEntry[]
  onClose: () => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(92,64,51,0.35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 100, padding: '20px',
      }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: '20px', width: '100%', maxWidth: '480px',
          maxHeight: '80vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
          boxShadow: '0 24px 60px rgba(92,64,51,0.25)',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px', padding: '18px 20px',
          borderBottom: '1px solid #F5EEF0',
        }}>
          <AlertTriangle size={18} color="#C9A055" />
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: '14px', fontWeight: 700, color: '#5C4033' }}>スキップ理由</p>
            <p style={{ fontSize: '10px', color: '#9F7E6C', marginTop: '2px' }}>
              取込対象外となった{entries.length}行の内訳
            </p>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer', color: '#C8A8B0',
            padding: '4px', display: 'flex',
          }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '8px 0' }}>
          {entries.length === 0 && (
            <p style={{ fontSize: '12px', color: '#C8A8B0', textAlign: 'center', padding: '24px' }}>
              スキップ理由の詳細はありません
            </p>
          )}
          {entries.map((entry, i) => (
            <div key={`${entry.rowNumber}-${i}`} style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '10px 20px',
              borderBottom: i < entries.length - 1 ? '1px solid #F8F2F3' : 'none',
            }}>
              <span style={{
                fontSize: '11px', fontWeight: 600, color: '#9F7E6C',
                background: '#FFF8F7', border: '1px solid #F5EEF0',
                borderRadius: '8px', padding: '3px 9px', whiteSpace: 'nowrap',
              }}>
                行{entry.rowNumber}
              </span>
              <span style={{ fontSize: '12px', fontWeight: 600, color: '#5C4033', flex: 1 }}>
                {entry.customerName || '(氏名未取得)'}
              </span>
              <span style={{
                fontSize: '10px', fontWeight: 700, color: '#EF476F',
                background: '#FFF0F0', border: '1px solid #FCCDD8',
                borderRadius: '999px', padding: '3px 9px', whiteSpace: 'nowrap',
              }}>
                {SKIPPED_DETAIL_REASON_LABEL[entry.reasonCode] ?? entry.reasonCode}
              </span>
            </div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  )
}
