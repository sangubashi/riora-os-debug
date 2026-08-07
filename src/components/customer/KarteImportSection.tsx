'use client'
/**
 * KarteImportSection.tsx — Salon Boardカルテ貼り付け MVP (Phase1)
 *
 * 設計: docs/CALTE_IMPORT_MVP_DESIGN.md
 * 3段階フロー:
 *   ① 入力    : カルテ原文を貼り付け → [解析する]
 *   ② レビュー: カテゴリ別の抽出候補をチェックボックスで確認・選択
 *   ③ 保存    : チェックした項目のみ customer_notes / contraindications へ保存
 *              （原文は選択状態に関わらず常に karte_imports へ保存）
 *
 * 安全保証:
 *   - 解析しただけでは DB に何も保存されない（analyze APIはDB非接触）
 *   - スタッフがチェックした項目だけが保存される（自動保存禁止）
 *   - 解析失敗時は保存せず、再試行を促す
 */
import { useState, useCallback, memo } from 'react'
import type { CSSProperties } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import { authedFetch } from '@/lib/api/authedFetch'
import type { KarteExtractionResult, KarteContraindicationCandidate } from '@/types/karteImport'
import { CONTRAINDICATION_SEVERITY_LABEL } from '@/types'

// ─── 型 ──────────────────────────────────────────────────────────────────────

type Phase = 'idle' | 'analyzing' | 'review' | 'saving'

interface NoteCandidate {
  key:     string
  label:   string
  content: string
}

const NOTE_GROUPS: Array<{ field: keyof KarteExtractionResult; label: string; defaultChecked: boolean }> = [
  { field: 'treatments',             label: '施術内容',   defaultChecked: true },
  { field: 'skinCondition',          label: '肌状態',     defaultChecked: true },
  { field: 'concerns',               label: '悩み',       defaultChecked: true },
  { field: 'precautions',            label: '注意事項',   defaultChecked: true },
  { field: 'nextProposalCandidates', label: '次回提案候補', defaultChecked: false },
]

function buildNoteCandidates(extracted: KarteExtractionResult): { candidates: NoteCandidate[]; defaultChecked: Set<string> } {
  const candidates: NoteCandidate[] = []
  const defaultChecked = new Set<string>()

  for (const group of NOTE_GROUPS) {
    const items = extracted[group.field] as Array<{ content: string }>
    items.forEach((item, i) => {
      const key = `${group.field}-${i}`
      candidates.push({ key, label: group.label, content: item.content })
      if (group.defaultChecked) defaultChecked.add(key)
    })
  }
  return { candidates, defaultChecked }
}

// ─── スタイルヘルパー（VoiceMemoSectionと同一トーン） ─────────────────────────

function pill(bg: string, color: string, borderColor?: string): CSSProperties {
  return {
    padding:      '11px',
    borderRadius: '999px',
    background:   bg,
    color,
    border:       borderColor ? `1.5px solid ${borderColor}` : 'none',
    fontSize:     '13px',
    fontWeight:   600,
    cursor:       'pointer',
  }
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  customerId:   string
  customerName: string
  onSaved:      () => void
}

// ─── コンポーネント ───────────────────────────────────────────────────────────

const KarteImportSectionInner = memo(function KarteImportSection({
  customerId,
  customerName,
  onSaved,
}: Props) {
  const [phase,          setPhase]          = useState<Phase>('idle')
  const [rawText,        setRawText]        = useState('')
  const [noteCandidates, setNoteCandidates] = useState<NoteCandidate[]>([])
  const [ciCandidates,   setCiCandidates]   = useState<KarteContraindicationCandidate[]>([])
  const [checkedNotes,   setCheckedNotes]   = useState<Set<string>>(new Set())
  const [checkedCi,      setCheckedCi]      = useState<Set<number>>(new Set())

  const fullReset = useCallback(() => {
    setPhase('idle')
    setRawText('')
    setNoteCandidates([])
    setCiCandidates([])
    setCheckedNotes(new Set())
    setCheckedCi(new Set())
  }, [])

  // ── ① 解析開始 ─────────────────────────────────────────────────────────────
  const handleAnalyze = useCallback(async () => {
    if (rawText.trim().length === 0 || phase === 'analyzing') return
    setPhase('analyzing')

    try {
      const res = await authedFetch(`/api/customers/${encodeURIComponent(customerId)}/karte-import/analyze`, {
        method: 'POST',
        body:   JSON.stringify({ rawText }),
      })

      if (!res.ok) {
        toast.error('解析に失敗しました。もう一度お試しください。')
        setPhase('idle')
        return
      }

      const { extracted } = await res.json() as { extracted: KarteExtractionResult }
      const { candidates, defaultChecked } = buildNoteCandidates(extracted)

      setNoteCandidates(candidates)
      setCheckedNotes(defaultChecked)
      setCiCandidates(extracted.contraindications)
      setCheckedCi(new Set(extracted.contraindications.map((_, i) => i))) // 禁忌事項は見落とし防止のためデフォルト全選択
      setPhase('review')
    } catch {
      toast.error('解析に失敗しました。もう一度お試しください。')
      setPhase('idle')
    }
  }, [rawText, phase, customerId])

  // ── ② チェックボックス切り替え ───────────────────────────────────────────
  const toggleNote = useCallback((key: string) => {
    setCheckedNotes(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }, [])

  const toggleCi = useCallback((idx: number) => {
    setCheckedCi(prev => {
      const next = new Set(prev)
      next.has(idx) ? next.delete(idx) : next.add(idx)
      return next
    })
  }, [])

  // ── ③ 保存 ─────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (phase === 'saving') return
    setPhase('saving')

    const selectedNotes = noteCandidates
      .filter(c => checkedNotes.has(c.key))
      .map(c => ({ content: c.content }))

    const selectedContraindications = ciCandidates.filter((_, i) => checkedCi.has(i))

    try {
      const res = await authedFetch(`/api/customers/${encodeURIComponent(customerId)}/karte-import/commit`, {
        method: 'POST',
        body:   JSON.stringify({ rawText, selectedNotes, selectedContraindications }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => null) as { reason?: string } | null
        const rawTextFailed = body?.reason?.startsWith('raw_text_save_failed')
        toast.error(rawTextFailed
          ? 'カルテの保存に失敗しました。もう一度お試しください。'
          : '一部の項目の保存に失敗しました。もう一度お試しください。')
        setPhase('review')
        return
      }

      toast.success('カルテを保存しました', { duration: 3000 })
      fullReset()
      onSaved()
    } catch {
      toast.error('カルテの保存に失敗しました。もう一度お試しください。')
      setPhase('review')
    }
  }, [phase, noteCandidates, checkedNotes, ciCandidates, checkedCi, customerId, rawText, fullReset, onSaved])

  const selectedCount = checkedNotes.size + checkedCi.size

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div style={{ background: '#F0F5FA', borderRadius: '22px', padding: '16px' }}>
      <p style={{ fontSize: '11px', letterSpacing: '0.18em', color: '#4878A8', fontWeight: 600, marginBottom: '12px' }}>
        📋 Salon Boardカルテ取込
      </p>

      <div style={{ background: '#fff', borderRadius: '18px', padding: '14px', border: '1px solid #C8DCF0' }}>
        <AnimatePresence mode="wait">

          {/* ── ① 入力: 貼り付け + 解析開始 ── */}
          {phase === 'idle' && (
            <motion.div key="idle"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <p style={{ fontSize: '10px', color: '#8AAAC8', letterSpacing: '0.05em' }}>
                Salon Boardのカルテ文章を貼り付けてください
              </p>
              <textarea
                value={rawText}
                onChange={e => setRawText(e.target.value)}
                rows={6}
                placeholder="カルテ文章を貼り付け…"
                style={{
                  width: '100%', fontSize: '12px', color: '#4878A8', lineHeight: 1.7,
                  padding: '10px', borderRadius: '10px',
                  border: '1.5px solid rgba(72,120,168,0.35)',
                  background: '#FAFCFF', outline: 'none', resize: 'vertical',
                  boxSizing: 'border-box',
                }}
              />
              <motion.button whileTap={{ scale: 0.97 }}
                onClick={handleAnalyze}
                disabled={rawText.trim().length === 0}
                style={{
                  ...pill(rawText.trim().length === 0 ? '#A0BCD8' : '#4878A8', '#fff'),
                  width: '100%', cursor: rawText.trim().length === 0 ? 'default' : 'pointer',
                }}>
                解析する
              </motion.button>
            </motion.div>
          )}

          {/* ── 解析中 ── */}
          {phase === 'analyzing' && (
            <motion.div key="analyzing"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              style={{ textAlign: 'center', padding: '20px 0' }}>
              <motion.span
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1.4, repeat: Infinity }}
                style={{ fontSize: '20px', color: '#4878A8' }}>✦</motion.span>
              <p style={{ fontSize: '12px', color: '#4878A8', marginTop: '8px' }}>解析中…</p>
            </motion.div>
          )}

          {/* ── ② レビュー: カテゴリ別チェックボックス ── */}
          {(phase === 'review' || phase === 'saving') && (
            <motion.div key="review"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

              <div style={{ background: '#F0F5FA', borderRadius: '10px', padding: '8px 10px' }}>
                <p style={{ fontSize: '11px', color: '#4878A8', fontWeight: 600 }}>
                  {customerName}様のカルテとして保存します
                </p>
              </div>

              <p style={{ fontSize: '10px', color: '#8AAAC8' }}>
                チェックしたものだけ保存されます
              </p>

              {noteCandidates.length === 0 && ciCandidates.length === 0 ? (
                <p style={{ fontSize: '12px', color: '#8AAAC8', textAlign: 'center', padding: '8px 0' }}>
                  抽出できる項目が見つかりませんでした
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {noteCandidates.map(c => (
                    <label key={c.key}
                      style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={checkedNotes.has(c.key)}
                        onChange={() => toggleNote(c.key)}
                        style={{ marginTop: '2px', width: '15px', height: '15px', accentColor: '#4878A8', flexShrink: 0 }}
                      />
                      <span style={{ fontSize: '12px', color: '#3d4858', lineHeight: 1.6 }}>
                        <span style={{ color: '#8AAAC8', fontSize: '10px', marginRight: '6px' }}>[{c.label}]</span>
                        {c.content}
                      </span>
                    </label>
                  ))}

                  {ciCandidates.map((ci, i) => (
                    <label key={`ci-${i}`}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer',
                        background: '#FFF0F2', border: '1.5px solid #F5C0C8', borderRadius: '10px', padding: '8px 10px',
                      }}>
                      <input
                        type="checkbox"
                        checked={checkedCi.has(i)}
                        onChange={() => toggleCi(i)}
                        style={{ marginTop: '2px', width: '15px', height: '15px', accentColor: '#C05060', flexShrink: 0 }}
                      />
                      <span style={{ fontSize: '12px', color: '#C05060', lineHeight: 1.6 }}>
                        <span style={{ fontWeight: 700, marginRight: '6px' }}>
                          ⚠️ 禁忌事項 [{CONTRAINDICATION_SEVERITY_LABEL[ci.severity]}]
                        </span>
                        {ci.title}{ci.description ? ` — ${ci.description}` : ''}
                      </span>
                    </label>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={fullReset} disabled={phase === 'saving'}
                  style={{ ...pill('#fff', '#688098', '#C8DCF0'), flex: 1, cursor: phase === 'saving' ? 'default' : 'pointer' }}>
                  破棄
                </button>
                <motion.button whileTap={{ scale: 0.97 }} onClick={handleSave}
                  disabled={phase === 'saving'}
                  style={{ ...pill(phase === 'saving' ? '#A0BCD8' : '#4878A8', '#fff'), flex: 2, cursor: phase === 'saving' ? 'default' : 'pointer' }}>
                  {phase === 'saving' ? '保存中…' : `保存（${selectedCount}件）`}
                </motion.button>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  )
})

KarteImportSectionInner.displayName = 'KarteImportSection'
export default KarteImportSectionInner
