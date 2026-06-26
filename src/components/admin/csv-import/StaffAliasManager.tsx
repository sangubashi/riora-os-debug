'use client'
/**
 * StaffAliasManager.tsx — スタッフ名エイリアス管理(画面⑥下部)
 *
 * brain_staff.name_aliases JSONB の表記ゆれ辞書をUIから閲覧・追加するためのモーダル。
 * 設計根拠: docs/architecture/Riora_Management_Dashboard_Architecture_v2.1.md §5
 */
import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Plus, BookUser } from 'lucide-react'
import { mockAddStaffAlias, mockFetchStaffAliases } from './mockApi'
import type { StaffAlias, StaffOption } from './types'

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function StaffAliasManager({ onClose }: { onClose: () => void }) {
  const [aliases, setAliases] = useState<StaffAlias[]>([])
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([])
  const [loading, setLoading] = useState(true)
  const [newAlias, setNewAlias] = useState('')
  const [newStaffId, setNewStaffId] = useState('')
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { staffOptions: options, aliases: rows } = await mockFetchStaffAliases()
    setStaffOptions(options)
    setAliases(rows)
    setNewStaffId((prev) => prev || options[0]?.id || '')
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleAdd = useCallback(async () => {
    const trimmed = newAlias.trim()
    if (!trimmed) return
    setAdding(true)
    const created = await mockAddStaffAlias(trimmed, newStaffId)
    setAliases((prev) => [created, ...prev])
    setNewAlias('')
    setAdding(false)
  }, [newAlias, newStaffId])

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
          <BookUser size={18} color="#D98292" />
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: '14px', fontWeight: 700, color: '#5C4033' }}>スタッフ名エイリアス管理</p>
            <p style={{ fontSize: '10px', color: '#9F7E6C', marginTop: '2px' }}>
              CSV担当者名の表記ゆれ辞書。一度紐付けると次回以降は自動解決されます。
            </p>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer', color: '#C8A8B0',
            padding: '4px', display: 'flex',
          }}>
            <X size={18} />
          </button>
        </div>

        <div style={{
          padding: '14px 20px', borderBottom: '1px solid #F5EEF0',
          display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap',
        }}>
          <input
            value={newAlias}
            onChange={(e) => setNewAlias(e.target.value)}
            placeholder="例: カメヤマ"
            style={{
              flex: '1 1 140px', padding: '9px 12px', borderRadius: '10px',
              border: '1px solid #F0E4E7', fontSize: '13px', color: '#5C4033',
              outline: 'none',
            }}
          />
          <span style={{ fontSize: '12px', color: '#C8A8B0' }}>→</span>
          <select
            value={newStaffId}
            onChange={(e) => setNewStaffId(e.target.value)}
            style={{
              padding: '9px 10px', borderRadius: '10px', border: '1px solid #F0E4E7',
              fontSize: '13px', color: '#5C4033', background: '#fff',
            }}
          >
            {staffOptions.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={handleAdd}
            disabled={!newAlias.trim() || !newStaffId || adding}
            style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              padding: '9px 14px', borderRadius: '10px', border: 'none',
              background: !newAlias.trim() || !newStaffId || adding ? '#F0E4E7' : 'linear-gradient(135deg, #F56E8B, #F0487A)',
              color: !newAlias.trim() || !newStaffId || adding ? '#C8A8B0' : '#fff',
              fontSize: '12px', fontWeight: 700, cursor: !newAlias.trim() || !newStaffId || adding ? 'default' : 'pointer',
            }}
          >
            <Plus size={13} /> {adding ? '追加中...' : '追加'}
          </motion.button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '8px 0' }}>
          {loading && (
            <p style={{ fontSize: '12px', color: '#C8A8B0', textAlign: 'center', padding: '24px' }}>読み込み中...</p>
          )}
          {!loading && aliases.length === 0 && (
            <p style={{ fontSize: '12px', color: '#C8A8B0', textAlign: 'center', padding: '24px' }}>
              登録されたエイリアスはまだありません
            </p>
          )}
          {!loading && aliases.map((a, i) => (
            <div key={a.id} style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '10px 20px',
              borderBottom: i < aliases.length - 1 ? '1px solid #F8F2F3' : 'none',
            }}>
              <span style={{
                fontSize: '12px', fontWeight: 600, color: '#5C4033',
                background: '#FFF8F7', border: '1px solid #F5EEF0',
                borderRadius: '8px', padding: '3px 9px',
              }}>
                {a.alias}
              </span>
              <span style={{ fontSize: '11px', color: '#C8A8B0' }}>→</span>
              <span style={{ fontSize: '12px', fontWeight: 600, color: '#D98292', flex: 1 }}>
                {a.staffName}
              </span>
              <span style={{ fontSize: '10px', color: '#C8A8B0' }}>
                {a.createdAt ? `${formatDateTime(a.createdAt)} 登録` : '登録日時不明'}
              </span>
            </div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  )
}
