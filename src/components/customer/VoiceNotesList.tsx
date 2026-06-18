'use client'
/**
 * VoiceNotesList.tsx
 * VoiceMemoSection の録音UI直下に表示する「過去メモ一覧」。
 * 最新10件を created_at DESC で表示し、AI解析結果（analysis_status / summary / insight_tags / transcript）を確認できる。
 */
import { useState } from 'react'
import { INSIGHT_TAG_LABELS, type InsightTag, type VoiceNoteAnalysisStatus } from '@/types'
import { formatDuration, type VoiceNoteRow } from '@/lib/voiceNote'

// ─── Props ────────────────────────────────────────────────────────────────────

interface VoiceNotesListProps {
  notes:       VoiceNoteRow[]
  loading:     boolean
  playingId:   string | null
  deletingId:  string | null
  onPlay:      (note: VoiceNoteRow) => void
  onDelete:    (note: VoiceNoteRow) => void
}

// ─── 解析ステータスバッジ ─────────────────────────────────────────────────────

const STATUS_LABEL: Record<VoiceNoteAnalysisStatus, string> = {
  pending:    '解析待ち',
  processing: '解析中',
  completed:  '解析完了',
  failed:     '解析失敗',
}
const STATUS_COLOR: Record<VoiceNoteAnalysisStatus, string> = {
  pending:    '#D4A017', // 黄
  processing: '#D4A017', // 黄
  completed:  '#2E8B57', // 緑
  failed:     '#C0392B', // 赤
}

function StatusBadge({ status }: { status: VoiceNoteAnalysisStatus }) {
  const color = STATUS_COLOR[status] ?? STATUS_COLOR.pending
  return (
    <span style={{
      fontSize: '9px', fontWeight: 700, padding: '2px 7px',
      borderRadius: '999px',
      background:  color + '22',
      color,
      border:      `1px solid ${color}44`,
      whiteSpace:  'nowrap',
      flexShrink:  0,
    }}>
      {STATUS_LABEL[status] ?? status}
    </span>
  )
}

// ─── コンポーネント ───────────────────────────────────────────────────────────

export default function VoiceNotesList({
  notes, loading, playingId, deletingId, onPlay, onDelete,
}: VoiceNotesListProps) {
  // transcript の展開状態（1件ずつ開閉）
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (loading) {
    return <p style={{ fontSize: '12px', color: '#A0BCD8', textAlign: 'center', padding: '4px 0' }}>読み込み中…</p>
  }

  if (notes.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '10px 0 4px' }}>
        <div style={{ fontSize: '18px', marginBottom: '5px', opacity: 0.35 }}>🎙️</div>
        <p style={{ fontSize: '12px', color: '#A0BCD8', lineHeight: 1.6 }}>
          音声メモはありません<br/>
          <span style={{ fontSize: '11px', color: '#B8D0E0' }}>接客後に録音すると自動でAI分析されます</span>
        </p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '320px', overflowY: 'auto', paddingRight: '2px' }}>
      {notes.map(note => {
        const isPlaying  = playingId === note.id
        const isDeleting = deletingId === note.id
        const isExpanded = expandedId === note.id
        const status     = note.analysis_status ?? 'pending'

        return (
          <div key={note.id}
            style={{ background: '#fff', borderRadius: '14px', padding: '10px 12px', border: '1px solid #C8DCF0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {/* 再生ボタン */}
              <button onClick={() => onPlay(note)}
                style={{ width: '34px', height: '34px', borderRadius: '50%', border: 'none', background: isPlaying ? '#E84050' : '#4878A8', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, fontSize: '14px' }}>
                {isPlaying ? '⏸' : '▶'}
              </button>

              {/* メタ情報 */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <p style={{ fontSize: '11px', color: '#4878A8', fontFamily: 'Inter, sans-serif', fontWeight: 600 }}>
                    {note.displayAt}
                  </p>
                  <StatusBadge status={status} />
                </div>
                {note.duration_sec !== null && (
                  <p style={{ fontSize: '10px', color: '#A0BCD8' }}>
                    {formatDuration(note.duration_sec)}
                  </p>
                )}
                {note.summary && (
                  <p style={{ fontSize: '11px', color: '#688098', marginTop: '2px', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' } as React.CSSProperties}>
                    {note.summary}
                  </p>
                )}
                {/* insight_tags 表示 */}
                {note.insight_tags && note.insight_tags.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '5px' }}>
                    {(note.insight_tags as InsightTag[]).slice(0, 3).map(tag => (
                      <span key={tag} style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '999px', background: '#E8F0FA', color: '#4878A8', fontWeight: 500 }}>
                        {INSIGHT_TAG_LABELS[tag] ?? tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* 削除ボタン */}
              <button onClick={() => onDelete(note)}
                disabled={isDeleting}
                style={{ width: '30px', height: '30px', borderRadius: '50%', border: 'none', background: '#F8F0F0', color: '#C07080', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: isDeleting ? 'default' : 'pointer', flexShrink: 0, fontSize: '13px', opacity: isDeleting ? 0.5 : 1 }}>
                {isDeleting ? '…' : '×'}
              </button>
            </div>

            {/* transcript（折りたたみ） */}
            {note.transcript && (
              <div style={{ marginTop: '8px', borderTop: '1px solid #F0F5FA', paddingTop: '8px' }}>
                <button onClick={() => setExpandedId(isExpanded ? null : note.id)}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '10px', color: '#8AAAC8', fontWeight: 600, letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  文字起こし{isExpanded ? 'を閉じる' : 'を見る'}
                  <span style={{ fontSize: '8px' }}>{isExpanded ? '▲' : '▼'}</span>
                </button>
                {isExpanded && (
                  <p style={{ fontSize: '11px', color: '#688098', lineHeight: 1.6, marginTop: '6px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {note.transcript}
                  </p>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
