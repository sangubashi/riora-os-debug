'use client'
/**
 * CsvImportScreen.tsx — CSV Import Management(画面⑥・owner専用)
 *
 * 設計根拠:
 *   - docs/architecture/Riora_Management_Dashboard_Architecture_v2.1.md §2(画面⑥ワイヤーフレーム)
 *   - docs/architecture/SalonBoard_CSV_Import_Implementation_Architecture_v1.0.md §1(状態機械)
 *
 * 状態機械: idle → parsing → dryrun_done → importing → done / error。
 * [2](dryrun_done)までは一切書込なし。mockApi.tsは実APIへのfetchラッパー(関数名はmock*のまま)。
 * ⑤取込実行はstateless APIのため、①で選んだFileをfileBlobRefに保持して再送する。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Upload, FileText, AlertCircle, CheckCircle2, X, ShieldAlert,
  UserCog, Users, History, BookUser, Loader2,
} from 'lucide-react'
import {
  mockDryRun, mockRunImport, mockFetchHistory, mockAddStaffAlias, mockFetchStaffAliases,
} from './mockApi'
import StaffAliasManager from './StaffAliasManager'
import type {
  ImportHistoryItem, ImportReport, ImportState, ReviewDecisionValue,
  StaffOption, ValidationResult,
} from './types'
import { SKIP_REASON_LABEL } from './types'

const PRIVACY_NOTICE =
  '電話番号・メール・郵便番号・建物名・部屋番号・メモ欄は保存されず、読み込み時点で破棄されます'

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ─── 小さなUIパーツ ───────────────────────────────────────────────────────────

function SectionCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #F5EEF0', borderRadius: '16px', padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '12px' }}>
        {icon}
        <p style={{ fontSize: '12px', fontWeight: 700, color: '#5C4033' }}>{title}</p>
      </div>
      {children}
    </div>
  )
}

function CountStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ flex: 1, minWidth: '88px', background: '#FFF8F7', borderRadius: '12px', padding: '10px 12px', border: '1px solid #F5EEF0' }}>
      <p style={{ fontSize: '9px', color: '#C8A8B0', marginBottom: '3px' }}>{label}</p>
      <p style={{ fontSize: '20px', fontWeight: 700, color, fontFamily: 'Inter, sans-serif', lineHeight: 1.1 }}>{value}</p>
    </div>
  )
}

// ─── メインコンポーネント ─────────────────────────────────────────────────────

export default function CsvImportScreen() {
  const fileRef = useRef<HTMLInputElement>(null)
  const fileBlobRef = useRef<File | null>(null)
  const [state, setState] = useState<ImportState>('idle')
  const [fileName, setFileName] = useState('')
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const [error, setError] = useState('')
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([])

  const [staffDecisions, setStaffDecisions] = useState<Record<string, string>>({})
  const [reviewDecisions, setReviewDecisions] = useState<Record<number, ReviewDecisionValue>>({})

  const [progress, setProgress] = useState<{ processed: number; total: number } | null>(null)
  const [report, setReport] = useState<ImportReport | null>(null)

  const [history, setHistory] = useState<ImportHistoryItem[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [showAliasManager, setShowAliasManager] = useState(false)

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    const rows = await mockFetchHistory()
    setHistory(rows)
    setHistoryLoading(false)
  }, [])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  useEffect(() => {
    mockFetchStaffAliases().then(({ staffOptions }) => setStaffOptions(staffOptions))
  }, [])

  // ─── ファイル選択・dry-run ─────────────────────────────────────────────────

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setState('error')
      setError('ファイル形式を確認してください(SalonBoardの標準CSV出力をご利用ください)')
      return
    }
    fileBlobRef.current = file
    setFileName(file.name)
    setState('parsing')
    setError('')
    setStaffDecisions({})
    setReviewDecisions({})
    setReport(null)

    try {
      const result = await mockDryRun(file)
      const defaults: Record<number, ReviewDecisionValue> = {}
      result.needsReview.forEach((r) => { defaults[r.rowNumber] = 'new' })
      setReviewDecisions(defaults)
      setValidation(result)
      setState('dryrun_done')
    } catch (e) {
      setError(String(e))
      setState('error')
    }
  }, [])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }, [handleFile])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const reset = useCallback(() => {
    setState('idle')
    setFileName('')
    setValidation(null)
    setError('')
    setStaffDecisions({})
    setReviewDecisions({})
    setProgress(null)
    setReport(null)
  }, [])

  // ─── 未解決スタッフ・要確認顧客の決定操作 ───────────────────────────────────

  const bindStaff = useCallback(async (rawName: string, staffId: string) => {
    setStaffDecisions((prev) => ({ ...prev, [rawName]: staffId }))
    const normalized = validation?.unresolvedStaff.find((u) => u.rawName === rawName)?.normalized ?? rawName
    await mockAddStaffAlias(normalized, staffId)
  }, [validation])

  const setReviewDecision = useCallback((rowNumber: number, decision: ReviewDecisionValue) => {
    setReviewDecisions((prev) => ({ ...prev, [rowNumber]: decision }))
  }, [])

  const allStaffResolved = useMemo(() => {
    if (!validation) return true
    return validation.unresolvedStaff.every((u) => staffDecisions[u.rawName])
  }, [validation, staffDecisions])

  const remainingUnresolvedCount = useMemo(() => {
    if (!validation) return 0
    return validation.unresolvedStaff.filter((u) => !staffDecisions[u.rawName]).length
  }, [validation, staffDecisions])

  // ─── 取込実行 ───────────────────────────────────────────────────────────────

  const handleImport = useCallback(async () => {
    const file = fileBlobRef.current
    if (!validation || !allStaffResolved || !file) return
    setState('importing')
    setProgress({ processed: 0, total: validation.totalRows })
    try {
      const result = await mockRunImport(file, validation.totalRows, reviewDecisions, (processedRows, totalRows) => {
        setProgress({ processed: processedRows, total: totalRows })
      })
      setReport(result)
      setState('done')
      loadHistory()
    } catch (e) {
      setError(String(e))
      setState('error')
    }
  }, [validation, allStaffResolved, reviewDecisions, loadHistory])

  return (
    <div style={{
      minHeight: '100dvh',
      background: 'linear-gradient(160deg, #FFF8F9 0%, #FAF0F4 40%, #FDF6F0 100%)',
      padding: '24px 16px max(40px, calc(24px + env(safe-area-inset-bottom)))',
    }}>
      <div style={{ maxWidth: '640px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>

        {/* ── ヘッダー ── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' }}>
          <div>
            <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: '20px', fontWeight: 400, color: '#5C4033', letterSpacing: '0.02em' }}>
              CSV Import Management
            </h1>
            <p style={{ fontSize: '11px', color: '#9F7E6C', marginTop: '4px' }}>
              SalonBoard CSV取込・名寄せ・取込履歴
            </p>
          </div>
          <span style={{
            display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', fontWeight: 700,
            color: '#D98292', background: '#FDEEF1', border: '1px solid #F6D6DD',
            borderRadius: '999px', padding: '4px 10px', whiteSpace: 'nowrap',
          }}>
            <ShieldAlert size={11} /> owner専用
          </span>
        </div>

        {/* ── PII破棄の常設文言 ── */}
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '10px 14px',
          background: '#FFFBF0', border: '1px solid #F4E4C2', borderRadius: '12px',
        }}>
          <ShieldAlert size={14} color="#C9A055" style={{ flexShrink: 0, marginTop: '1px' }} />
          <p style={{ fontSize: '11px', color: '#9F7E6C', lineHeight: 1.5 }}>{PRIVACY_NOTICE}</p>
        </div>

        {/* ── ① CSVアップロード ── */}
        <SectionCard title="① CSVを選択(.csv・SJIS対応)" icon={<Upload size={15} color="#D98292" />}>
          <AnimatePresence mode="wait">
            {state === 'idle' && (
              <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <div
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleDrop}
                  style={{
                    border: '2px dashed #F0E4E7', borderRadius: '14px', padding: '26px 16px',
                    textAlign: 'center', cursor: 'pointer', background: '#FFF8F7',
                  }}
                >
                  <Upload size={22} color="#F56E8B" style={{ margin: '0 auto 8px' }} />
                  <p style={{ fontSize: '12px', fontWeight: 600, color: '#5C4033', marginBottom: '4px' }}>
                    CSVファイルを選択またはドロップ
                  </p>
                  <p style={{ fontSize: '10px', color: '#C8A8B0' }}>SalonBoard エクスポートCSV・10MB上限</p>
                </div>
                <input ref={fileRef} type="file" accept=".csv" onChange={handleInputChange} style={{ display: 'none' }} />
              </motion.div>
            )}

            {state === 'parsing' && (
              <motion.div key="parsing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                style={{ textAlign: 'center', padding: '20px' }}>
                <motion.div style={{ margin: '0 auto 10px', width: '22px', height: '22px' }}
                  animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.9, ease: 'linear' }}>
                  <Loader2 size={22} color="#F56E8B" />
                </motion.div>
                <p style={{ fontSize: '12px', color: '#9F7E6C' }}>「{fileName}」を解析・検証中(Dry Run)...</p>
              </motion.div>
            )}

            {(state === 'dryrun_done' || state === 'importing' || state === 'done') && validation && (
              <motion.div key="selected" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 12px',
                  background: '#F8F5F0', borderRadius: '10px', border: '1px solid #EDE5DC',
                }}>
                <FileText size={14} color="#C8A58C" />
                <p style={{ fontSize: '11px', color: '#9F7E6C', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {validation.fileName}
                </p>
                <span style={{ fontSize: '10px', color: '#C8A8B0' }}>{validation.totalRows}行</span>
                {state === 'done' && (
                  <button onClick={reset} style={{
                    background: 'none', border: 'none', cursor: 'pointer', color: '#C8A8B0',
                    display: 'flex', alignItems: 'center', gap: '3px', fontSize: '11px',
                  }}>
                    <X size={12} /> 新しいCSVを取り込む
                  </button>
                )}
              </motion.div>
            )}

            {state === 'error' && (
              <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: '7px', padding: '10px 12px',
                  background: '#FFF0F0', borderRadius: '10px', border: '1px solid #FCCDD8', marginBottom: '10px',
                }}>
                  <AlertCircle size={14} color="#EF476F" style={{ flexShrink: 0, marginTop: '1px' }} />
                  <p style={{ fontSize: '11px', color: '#EF476F', lineHeight: 1.5 }}>{error}</p>
                </div>
                <button onClick={reset} style={{
                  fontSize: '12px', fontWeight: 600, color: '#F56E8B', background: 'none',
                  border: '1px solid #F6D6DD', borderRadius: '10px', padding: '8px 14px', cursor: 'pointer',
                }}>
                  もう一度選択する
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </SectionCard>

        {/* ── ② Dry Run結果 ── */}
        {validation && state !== 'parsing' && state !== 'idle' && (
          <SectionCard title="② Dry Run結果" icon={<FileText size={15} color="#D98292" />}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
              <CountStat label="取込可" value={validation.importable} color="#2D6A4F" />
              <CountStat label="要確認" value={validation.needsReview.length} color="#C9A055" />
              <CountStat label="除外" value={validation.skipped.length} color="#9F7E6C" />
              <CountStat label="PII検出" value={validation.piiFoundTotal} color="#EF476F" />
            </div>

            <p style={{ fontSize: '10px', color: '#C8A8B0', marginBottom: '6px' }}>破棄した列</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '12px' }}>
              {validation.droppedColumns.map((col) => (
                <span key={col} style={{
                  fontSize: '10px', color: '#9F7E6C', background: '#F8F5F0',
                  border: '1px solid #EDE5DC', borderRadius: '999px', padding: '2px 9px',
                }}>
                  {col}
                </span>
              ))}
            </div>

            {validation.unknownColumns.length > 0 && (
              <div style={{ marginBottom: '12px' }}>
                <p style={{ fontSize: '10px', color: '#C8A8B0', marginBottom: '6px' }}>未知の列(無視)</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                  {validation.unknownColumns.map((col) => (
                    <span key={col} style={{
                      fontSize: '10px', color: '#C8A8B0', background: '#FAFAFA',
                      border: '1px dashed #E5E5E5', borderRadius: '999px', padding: '2px 9px',
                    }}>
                      {col}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {validation.skipped.length > 0 && (
              <div style={{ marginBottom: '12px' }}>
                <p style={{ fontSize: '10px', color: '#C8A8B0', marginBottom: '6px' }}>
                  除外行({validation.skipped.length}件)
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', maxHeight: '110px', overflowY: 'auto' }}>
                  {validation.skipped.map((s, i) => (
                    <p key={s.rowNumber ?? `${s.checkoutId}-${i}`} style={{ fontSize: '10px', color: '#9F7E6C' }}>
                      {s.rowNumber ? `行${s.rowNumber}` : `会計ID ${s.checkoutId}`}: {SKIP_REASON_LABEL[s.reasonCode]}
                    </p>
                  ))}
                </div>
              </div>
            )}

            <p style={{ fontSize: '10px', color: '#C8A8B0', marginBottom: '6px' }}>
              プレビュー(保持項目のみ・先頭{validation.preview.length}行)
            </p>
            <div style={{ border: '1px solid #F5EEF0', borderRadius: '12px', overflow: 'hidden' }}>
              {validation.preview.map((row, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px',
                  borderBottom: i < validation.preview.length - 1 ? '1px solid #F8F2F3' : 'none',
                  background: i % 2 === 0 ? '#fff' : '#FFFBF8', fontSize: '11px', color: '#5C4033',
                }}>
                  <span style={{ fontWeight: 600, minWidth: '72px' }}>{row.name}</span>
                  <span style={{ color: '#9F7E6C', minWidth: '36px' }}>{row.gender ?? '—'}</span>
                  <span style={{ color: '#9F7E6C', minWidth: '36px' }}>{row.ageGroup ?? '—'}</span>
                  <span style={{ color: '#9F7E6C', flex: 1 }}>{row.prefecture}{row.city}</span>
                  <span style={{ color: '#C8A8B0', fontSize: '10px' }}>{row.firstVisitDate}</span>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* ── ③ 未解決スタッフ(名寄せ) ── */}
        {validation && validation.unresolvedStaff.length > 0 && state !== 'parsing' && state !== 'idle' && (
          <SectionCard title="③ 未解決スタッフ(名寄せ)" icon={<UserCog size={15} color="#D98292" />}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {validation.unresolvedStaff.map((u) => {
                const resolvedTo = staffDecisions[u.rawName]
                const suggested = u.suggestedStaffId
                  ? staffOptions.find((s) => s.id === u.suggestedStaffId)
                  : undefined
                return (
                  <div key={u.rawName} style={{
                    display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
                    padding: '9px 12px', borderRadius: '10px',
                    background: resolvedTo ? '#F0FFF8' : '#FFF8F0',
                    border: `1px solid ${resolvedTo ? '#B7E4C7' : '#FFE2A8'}`,
                  }}>
                    {resolvedTo ? <CheckCircle2 size={14} color="#52B788" /> : <AlertCircle size={14} color="#E0A03C" />}
                    <span style={{ fontSize: '12px', fontWeight: 600, color: '#5C4033' }}>&ldquo;{u.rawName}&rdquo;</span>
                    <span style={{ fontSize: '10px', color: '#C8A8B0' }}>{u.occurrenceCount}件</span>

                    {resolvedTo ? (
                      <span style={{ fontSize: '11px', color: '#2D6A4F', fontWeight: 600 }}>
                        → {staffOptions.find((s) => s.id === resolvedTo)?.name} に紐付け済
                      </span>
                    ) : (
                      <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto', flexWrap: 'wrap' }}>
                        {suggested && (
                          <button onClick={() => bindStaff(u.rawName, suggested.id)} style={{
                            fontSize: '11px', fontWeight: 600, color: '#fff', background: '#D98292',
                            border: 'none', borderRadius: '8px', padding: '5px 11px', cursor: 'pointer',
                          }}>
                            {suggested.name}に紐付け
                          </button>
                        )}
                        <select
                          defaultValue=""
                          onChange={(e) => { if (e.target.value) bindStaff(u.rawName, e.target.value) }}
                          style={{
                            fontSize: '11px', color: '#5C4033', border: '1px solid #F0E4E7',
                            borderRadius: '8px', padding: '5px 8px', background: '#fff',
                          }}
                        >
                          <option value="" disabled>他のスタッフを選ぶ</option>
                          {staffOptions.map((s) => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            {remainingUnresolvedCount > 0 && (
              <p style={{ fontSize: '11px', color: '#C9A055', marginTop: '10px' }}>
                未解決のスタッフ名が{remainingUnresolvedCount}件あります。全件紐付けるまで取込は実行できません。
              </p>
            )}
          </SectionCard>
        )}

        {/* ── ④ 要確認顧客(同姓同名) ── */}
        {validation && validation.needsReview.length > 0 && state !== 'parsing' && state !== 'idle' && (
          <SectionCard title="④ 要確認顧客(同姓同名)" icon={<Users size={15} color="#D98292" />}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {validation.needsReview.map((r) => {
                const decision = reviewDecisions[r.rowNumber] ?? 'new'
                return (
                  <div key={r.rowNumber} style={{
                    display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
                    padding: '9px 12px', borderRadius: '10px', background: '#FFF8F7', border: '1px solid #F5EEF0',
                  }}>
                    <div style={{ flex: '1 1 160px' }}>
                      <p style={{ fontSize: '12px', fontWeight: 600, color: '#5C4033' }}>{r.customerName}(行{r.rowNumber})</p>
                      <p style={{ fontSize: '10px', color: '#C8A8B0' }}>候補: {r.candidateMatchName}</p>
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button onClick={() => setReviewDecision(r.rowNumber, 'merge')} style={{
                        fontSize: '11px', fontWeight: 600, borderRadius: '8px', padding: '5px 10px', cursor: 'pointer',
                        border: decision === 'merge' ? 'none' : '1px solid #F0E4E7',
                        background: decision === 'merge' ? '#D98292' : '#fff',
                        color: decision === 'merge' ? '#fff' : '#9F7E6C',
                      }}>
                        同一人物として統合
                      </button>
                      <button onClick={() => setReviewDecision(r.rowNumber, 'new')} style={{
                        fontSize: '11px', fontWeight: 600, borderRadius: '8px', padding: '5px 10px', cursor: 'pointer',
                        border: decision === 'new' ? 'none' : '1px solid #F0E4E7',
                        background: decision === 'new' ? '#5C4033' : '#fff',
                        color: decision === 'new' ? '#fff' : '#9F7E6C',
                      }}>
                        別人として新規
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </SectionCard>
        )}

        {/* ── ⑤ 取込実行 / 進捗 / 完了レポート ── */}
        {validation && state === 'dryrun_done' && (
          <div>
            <motion.button
              whileTap={{ scale: allStaffResolved ? 0.97 : 1 }}
              onClick={handleImport}
              disabled={!allStaffResolved}
              style={{
                width: '100%', padding: '14px', border: 'none', borderRadius: '14px',
                cursor: allStaffResolved ? 'pointer' : 'default',
                background: allStaffResolved ? 'linear-gradient(135deg, #F56E8B, #F0487A)' : '#F0E4E7',
                color: allStaffResolved ? '#fff' : '#C8A8B0',
                fontSize: '13px', fontWeight: 700,
                boxShadow: allStaffResolved ? '0 6px 20px rgba(245,110,139,0.35)' : 'none',
              }}
            >
              ⑤ この内容で取り込む({validation.importable}件)
            </motion.button>
          </div>
        )}

        {state === 'importing' && progress && (
          <SectionCard
            title="取込実行中"
            icon={
              <motion.div style={{ width: '15px', height: '15px' }}
                animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.9, ease: 'linear' }}>
                <Loader2 size={15} color="#D98292" />
              </motion.div>
            }
          >
            <div style={{ background: '#F5EEF0', borderRadius: '6px', height: '8px', overflow: 'hidden', marginBottom: '8px' }}>
              <motion.div
                animate={{ width: `${(progress.processed / progress.total) * 100}%` }}
                transition={{ ease: 'easeOut' }}
                style={{ background: 'linear-gradient(135deg, #F56E8B, #F0487A)', height: '100%', borderRadius: '6px' }}
              />
            </div>
            <p style={{ fontSize: '11px', color: '#9F7E6C', textAlign: 'center' }}>
              {progress.processed} / {progress.total} 行(500行/チャンク)
            </p>
          </SectionCard>
        )}

        {state === 'done' && report && (
          <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
            style={{ background: '#F0FFF8', borderRadius: '16px', padding: '20px', textAlign: 'center', border: '1px solid #74C69D44' }}>
            <CheckCircle2 size={26} color="#52B788" style={{ margin: '0 auto 8px' }} />
            <p style={{ fontSize: '13px', fontWeight: 700, color: '#2D6A4F', marginBottom: '10px' }}>取込完了</p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '18px', flexWrap: 'wrap' }}>
              <div>
                <p style={{ fontSize: '9px', color: '#74C69D' }}>新規</p>
                <p style={{ fontSize: '18px', fontWeight: 700, color: '#2D6A4F', fontFamily: 'Inter, sans-serif' }}>{report.newCustomers}</p>
              </div>
              <div>
                <p style={{ fontSize: '9px', color: '#74C69D' }}>更新</p>
                <p style={{ fontSize: '18px', fontWeight: 700, color: '#2D6A4F', fontFamily: 'Inter, sans-serif' }}>{report.updatedCustomers}</p>
              </div>
              <div>
                <p style={{ fontSize: '9px', color: '#74C69D' }}>来店履歴</p>
                <p style={{ fontSize: '18px', fontWeight: 700, color: '#2D6A4F', fontFamily: 'Inter, sans-serif' }}>{report.visitsImported}</p>
              </div>
              <div>
                <p style={{ fontSize: '9px', color: '#74C69D' }}>PII混入検出</p>
                <p style={{ fontSize: '18px', fontWeight: 700, color: '#2D6A4F', fontFamily: 'Inter, sans-serif' }}>{report.piiFoundTotal}</p>
              </div>
            </div>
            <p style={{ fontSize: '10px', color: '#52B788', marginTop: '12px' }}>ops_logsで監査可能(内容は記録されません)</p>
          </motion.div>
        )}

        {/* ── 取込履歴 ── */}
        <SectionCard title="取込履歴" icon={<History size={15} color="#D98292" />}>
          {historyLoading ? (
            <p style={{ fontSize: '11px', color: '#C8A8B0', textAlign: 'center', padding: '12px' }}>読み込み中...</p>
          ) : history.length === 0 ? (
            <p style={{ fontSize: '11px', color: '#C8A8B0', textAlign: 'center', padding: '12px' }}>取込履歴はまだありません</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {history.map((h) => (
                <div key={h.id} style={{
                  display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px',
                  borderRadius: '10px', background: '#FFF8F7',
                }}>
                  <span style={{ fontSize: '11px', color: '#9F7E6C', minWidth: '78px' }}>{formatDateTime(h.importedAt)}</span>
                  <span style={{ fontSize: '11px', color: '#5C4033' }}>新規{h.newCustomers} 更新{h.updatedCustomers} 来店{h.visits}</span>
                  {h.unresolvedStaffCount > 0 && (
                    <span style={{ fontSize: '10px', color: '#E0A03C', marginLeft: 'auto' }}>未解決{h.unresolvedStaffCount}件</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* ── スタッフ名エイリアス管理 ── */}
        <button onClick={() => setShowAliasManager(true)} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
          padding: '12px', borderRadius: '12px', border: '1px solid #F0E4E7', background: '#fff',
          color: '#9F7E6C', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
        }}>
          <BookUser size={14} /> スタッフ名エイリアス管理
        </button>
      </div>

      <AnimatePresence>
        {showAliasManager && <StaffAliasManager onClose={() => setShowAliasManager(false)} />}
      </AnimatePresence>
    </div>
  )
}
