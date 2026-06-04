'use client'
/**
 * SalonBoardImportPanel.tsx  — SalonBoard CSV 取込 UI
 *
 * KPI画面に差し込む。
 * CSV選択 → 解析 → プレビュー表示 → Supabase保存。
 * DEMO_MODE=true の場合は保存をスキップして画面のみ表示。
 */
import { useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Upload, FileText, CheckCircle, AlertCircle, X } from 'lucide-react'
import { runSalonBoardImport, summarizeImport } from '@/lib/import/SalonBoardImportEngine'
import { checkCsvQuality } from '@/lib/import/csvQualityChecker'
import type { CsvQualityResult } from '@/lib/import/csvQualityChecker'
import { saveSalonBoardImport } from '@/lib/import/SalonBoardSaveEngine'
import {
  toAnalyticsRows, toVipRows, toTreatmentRows, toProductRows,
} from '@/lib/import/SalonBoardImportEngine'
import { useAnalyticsStore } from '@/store/useAnalyticsStore'
import { CUSTOMER_PHASE_LABEL, CUSTOMER_PHASE_COLOR } from '@/types'
import type { SalonBoardImportResult } from '@/types'
import type { ImportKpiSummary } from '@/lib/import/SalonBoardImportEngine'
import type { SalonBoardSaveResult } from '@/types'
import type { CustomerPhase } from '@/types'

type ImportState = 'idle' | 'parsing' | 'preview' | 'saving' | 'imported'

function formatYen(n: number): string {
  return n >= 10000 ? `¥${Math.round(n / 10000)}万` : `¥${n.toLocaleString()}`
}

// ─── フェーズバッジ ───────────────────────────────────────────────────────────

function PhaseBadge({ phase }: { phase: CustomerPhase }) {
  return (
    <span style={{
      fontSize: '9px', fontWeight: 700, padding: '1px 6px',
      borderRadius: '999px',
      background: CUSTOMER_PHASE_COLOR[phase] + '22',
      color:      CUSTOMER_PHASE_COLOR[phase],
      border:     `1px solid ${CUSTOMER_PHASE_COLOR[phase]}44`,
      whiteSpace: 'nowrap',
    }}>
      {CUSTOMER_PHASE_LABEL[phase]}
    </span>
  )
}

// ─── KPI サマリカード ─────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ background: '#FFF8F7', borderRadius: '12px', padding: '10px 12px',
      border: '1px solid #F5EEF0', flex: 1, minWidth: '70px' }}>
      <p style={{ fontSize: '9px', color: '#C8A8B0', marginBottom: '3px' }}>{label}</p>
      <p style={{ fontSize: '15px', fontWeight: 700, color: '#5C4033',
        fontFamily: 'Inter, sans-serif', lineHeight: 1.1 }}>
        {value}
      </p>
      {sub && <p style={{ fontSize: '9px', color: '#C8A8B0', marginTop: '2px' }}>{sub}</p>}
    </div>
  )
}

// ─── メインコンポーネント ─────────────────────────────────────────────────────

export default function SalonBoardImportPanel() {
  const refreshFromCsv = useAnalyticsStore(s => s.refreshFromCsv)
  const fileRef                = useRef<HTMLInputElement>(null)
  const [state, setState]      = useState<ImportState>('idle')
  const [fileName, setFileName] = useState<string>('')
  const [result, setResult]    = useState<SalonBoardImportResult | null>(null)
  const [summary, setSummary]  = useState<ImportKpiSummary | null>(null)
  const [saveResult, setSaveResult] = useState<SalonBoardSaveResult | null>(null)
  const [quality, setQuality]      = useState<CsvQualityResult | null>(null)
  const [error, setError]          = useState<string>('')
  const [showAll, setShowAll]  = useState(false)

  // ─── CSV 読み込み ─────────────────────────────────────────────────────────

  const handleFile = useCallback(async (file: File) => {
    setFileName(file.name)
    setState('parsing')
    setError('')

    try {
      const text = await file.text()
      const res  = runSalonBoardImport(text)
      const sum  = summarizeImport(res)
      const qual = checkCsvQuality(res.customers.flatMap(c =>
        Array.from({ length: c.visits }, () => ({
          customerName:  c.displayName,
          visitDate:     c.lastVisitDate,
          sales:         Math.round(c.totalSales / c.visits),
          treatment:     c.treatments[0] ?? '不明',
          retailSales:   Math.round(c.retailSales / c.visits),
          staffName:     c.assignedStaff[0] ?? '',
          hasNextRebook: c.rebookCount > 0,
          isDesignated:  c.designatedCount > 0,
        }))
      ))
      setResult(res)
      setSummary(sum)
      setQuality(qual)
      setState('preview')
    } catch (e) {
      setError(String(e))
      setState('idle')
    }
  }, [])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    // input をリセット（同じファイルの再選択を可能にする）
    e.target.value = ''
  }, [handleFile])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file && file.name.endsWith('.csv')) handleFile(file)
  }, [handleFile])

  const reset = useCallback(() => {
    setState('idle')
    setResult(null)
    setSummary(null)
    setSaveResult(null)
    setQuality(null)
    setFileName('')
    setError('')
    setShowAll(false)
  }, [])

  // ─── 取込実行（Supabase保存 + 全分析再計算） ─────────────────────────────

  const handleImport = useCallback(async () => {
    if (!result) return
    setState('saving')
    try {
      // Supabase 保存
      const saveRes = await saveSalonBoardImport(result)
      setSaveResult(saveRes)

      // 全分析を CSV データで再計算
      refreshFromCsv(
        toAnalyticsRows(result.customers),
        toVipRows(result.customers),
        toTreatmentRows(result.customers),
        toProductRows(result.customers),
      )

      setState('imported')
    } catch (e) {
      setError(String(e))
      setState('preview')
    }
  }, [result, refreshFromCsv])

  // ─── レンダリング ─────────────────────────────────────────────────────────

  const phases: CustomerPhase[] = ['vip', 'repeat', 'growing', 'new', 'risk']
  const displayCustomers = result
    ? (showAll ? result.customers : result.customers.slice(0, 5))
    : []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

      {/* タイトル行 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <p style={{ fontSize: '11px', color: '#C8A58C', fontWeight: 600, letterSpacing: '0.1em' }}>
            📥 CSV取込
          </p>
          <span style={{ fontSize: '9px', background: '#F0F8FF', color: '#4878A8',
            padding: '1px 6px', borderRadius: '999px', border: '1px solid #B8D4F0' }}>
            SalonBoard
          </span>
        </div>
        {state !== 'idle' && (
          <button onClick={reset}
            style={{ background: 'none', border: 'none', cursor: 'pointer',
              color: '#C8A8B0', display: 'flex', alignItems: 'center', gap: '3px',
              fontSize: '11px' }}>
            <X size={12} /> リセット
          </button>
        )}
      </div>

      <AnimatePresence mode="wait">

        {/* ── IDLE: ファイル選択 ── */}
        {state === 'idle' && (
          <motion.div key="idle"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={handleDrop}
              style={{
                border: '2px dashed #F0E8E8', borderRadius: '16px',
                padding: '28px 16px', textAlign: 'center',
                cursor: 'pointer', background: '#FFF8F7',
                transition: 'all 0.15s',
              }}
            >
              <Upload size={24} color="#F56E8B" style={{ margin: '0 auto 8px' }} />
              <p style={{ fontSize: '12px', fontWeight: 600, color: '#5C4033', marginBottom: '4px' }}>
                CSVファイルを選択またはドロップ
              </p>
              <p style={{ fontSize: '10px', color: '#C8A8B0' }}>
                SalonBoard エクスポートCSVに対応
              </p>
            </div>
            <input ref={fileRef} type="file" accept=".csv"
              onChange={handleInputChange}
              style={{ display: 'none' }} />
            {error && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px',
                padding: '8px 12px', background: '#FFF0F0', borderRadius: '10px',
                border: '1px solid #FCCDD8', marginTop: '8px' }}>
                <AlertCircle size={14} color="#EF476F" />
                <p style={{ fontSize: '11px', color: '#EF476F' }}>{error}</p>
              </div>
            )}
          </motion.div>
        )}

        {/* ── PARSING: 解析中 ── */}
        {state === 'parsing' && (
          <motion.div key="parsing"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ background: '#FFF8F7', borderRadius: '16px', padding: '28px',
              textAlign: 'center', border: '1px solid #F5EEF0' }}>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '4px', marginBottom: '10px' }}>
              {[0,1,2].map(i => (
                <motion.div key={i}
                  animate={{ scale: [1, 1.3, 1] }}
                  transition={{ repeat: Infinity, duration: 0.8, delay: i * 0.15 }}
                  style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#F56E8B' }}
                />
              ))}
            </div>
            <p style={{ fontSize: '12px', color: '#9F7E6C' }}>「{fileName}」を解析中...</p>
          </motion.div>
        )}

        {/* ── SAVING: 保存中 ── */}
        {state === 'saving' && (
          <motion.div key="saving"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ background: '#F0F8FF', borderRadius: '16px', padding: '28px',
              textAlign: 'center', border: '1px solid #B8D4F0' }}>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '4px', marginBottom: '10px' }}>
              {[0,1,2].map(i => (
                <motion.div key={i}
                  animate={{ scale: [1, 1.3, 1] }}
                  transition={{ repeat: Infinity, duration: 0.8, delay: i * 0.15 }}
                  style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#4878A8' }}
                />
              ))}
            </div>
            <p style={{ fontSize: '12px', color: '#4878A8' }}>Supabaseへ保存中...</p>
          </motion.div>
        )}

        {/* ── IMPORTED: 完了 ── */}
        {state === 'imported' && saveResult && (
          <motion.div key="imported"
            initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
            style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ background: '#F0FFF8', borderRadius: '16px', padding: '20px',
              textAlign: 'center', border: '1px solid #74C69D44' }}>
              <CheckCircle size={28} color="#52B788" style={{ margin: '0 auto 8px' }} />
              <p style={{ fontSize: '13px', fontWeight: 700, color: '#2D6A4F', marginBottom: '4px' }}>
                取込完了
              </p>
              <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', marginTop: '8px' }}>
                <div>
                  <p style={{ fontSize: '9px', color: '#74C69D' }}>新規作成</p>
                  <p style={{ fontSize: '18px', fontWeight: 700, color: '#2D6A4F',
                    fontFamily: 'Inter, sans-serif' }}>{saveResult.customersCreated}</p>
                </div>
                <div>
                  <p style={{ fontSize: '9px', color: '#74C69D' }}>更新</p>
                  <p style={{ fontSize: '18px', fontWeight: 700, color: '#2D6A4F',
                    fontFamily: 'Inter, sans-serif' }}>{saveResult.customersUpdated}</p>
                </div>
                <div>
                  <p style={{ fontSize: '9px', color: '#74C69D' }}>来店ログ</p>
                  <p style={{ fontSize: '18px', fontWeight: 700, color: '#2D6A4F',
                    fontFamily: 'Inter, sans-serif' }}>{saveResult.visitsInserted}</p>
                </div>
              </div>
              {/* 分析更新メッセージ */}
              <div style={{ marginTop: '12px', padding: '8px 14px',
                background: '#E8F4FF', borderRadius: '10px', border: '1px solid #B8D4F0' }}>
                <p style={{ fontSize: '11px', color: '#4878A8', fontWeight: 600, textAlign: 'center' }}>
                  🧠 分析を更新しました
                </p>
                <p style={{ fontSize: '10px', color: '#6898C8', textAlign: 'center', marginTop: '2px' }}>
                  CustomerPhase・Score・VIP類似度・店舗学習が再計算されました
                </p>
              </div>
            </div>
            {saveResult.errors.length > 0 && (
              <div style={{ padding: '8px 12px', background: '#FFF8F0', borderRadius: '10px',
                border: '1px solid #FFD166' }}>
                {saveResult.errors.map((e: string, i: number) => (
                  <p key={i} style={{ fontSize: '10px', color: '#9F7E6C' }}>⚠️ {e}</p>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {/* ── PREVIEW: 結果プレビュー ── */}
        {state === 'preview' && result && summary && (
          <motion.div key="preview"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

            {/* ファイル名バー */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px',
              padding: '8px 12px', background: '#F8F5F0', borderRadius: '10px',
              border: '1px solid #EDE5DC' }}>
              <FileText size={14} color="#C8A58C" />
              <p style={{ fontSize: '11px', color: '#9F7E6C', flex: 1,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {fileName}
              </p>
              <span style={{ fontSize: '10px', color: '#C8A8B0' }}>
                {result.totalRows}行 / スキップ{result.skippedRows}行
              </span>
            </div>

            {/* エラー・警告 */}
            {result.errors.filter((e: string) => !e.startsWith('[INFO]')).length > 0 && (
              <div style={{ padding: '8px 12px', background: '#FFF8F0', borderRadius: '10px',
                border: '1px solid #FFD166' }}>
                {result.errors.filter((e: string) => !e.startsWith('[INFO]')).map((e: string, i: number) => (
                  <p key={i} style={{ fontSize: '10px', color: '#9F7E6C' }}>⚠️ {e}</p>
                ))}
              </div>
            )}

            {/* KPI サマリ */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              <SummaryCard label="顧客数"     value={`${summary.totalCustomers}名`} />
              <SummaryCard label="総売上"     value={formatYen(summary.totalSales)} />
              <SummaryCard label="平均売上/人" value={formatYen(summary.avgSalesPerCustomer)} />
              <SummaryCard label="次回予約率"  value={`${summary.rebookRate}%`} />
            </div>

            {/* 品質スコア */}
            {quality && (
              <div style={{ background: '#fff', border: '1px solid #F5EEF0',
                borderRadius: '14px', padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  marginBottom: '8px' }}>
                  <p style={{ fontSize: '10px', color: '#C8A8B0', fontWeight: 600 }}>
                    CSV品質スコア
                  </p>
                  <span style={{
                    fontSize: '18px', fontWeight: 700, fontFamily: 'Inter, sans-serif',
                    color: quality.score >= 90 ? '#52B788' : quality.score >= 75 ? '#FFD166' : '#EF476F',
                  }}>
                    {quality.score}<span style={{ fontSize: '11px', fontWeight: 400, color: '#C8A8B0' }}>点</span>
                  </span>
                </div>
                {/* バー */}
                <div style={{ background: '#F5EEF0', borderRadius: '4px', height: '5px',
                  overflow: 'hidden', marginBottom: '8px' }}>
                  <div style={{
                    background: quality.score >= 90 ? '#52B788' : quality.score >= 75 ? '#FFD166' : '#EF476F',
                    width: `${quality.score}%`, height: '100%', borderRadius: '4px',
                    transition: 'width 0.5s ease',
                  }} />
                </div>
                {/* 警告リスト */}
                {quality.warnings.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {quality.warnings.map((w, i) => (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'flex-start', gap: '5px',
                        padding: '5px 8px', borderRadius: '8px',
                        background: w.severity === 'warn' ? '#FFF8F0'
                          : w.severity === 'error' ? '#FFF0F0' : '#F8F5F0',
                        border: `1px solid ${w.severity === 'warn' ? '#FFD166'
                          : w.severity === 'error' ? '#FCCDD8' : '#EDE5DC'}`,
                      }}>
                        <span style={{ fontSize: '11px', flexShrink: 0, marginTop: '0px' }}>
                          {w.severity === 'error' ? '❌' : w.severity === 'warn' ? '⚠️' : 'ℹ️'}
                        </span>
                        <p style={{ fontSize: '10px', color: '#5C4033', lineHeight: 1.5 }}>
                          {w.message}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
                <p style={{ fontSize: '10px', color: '#C8A8B0', marginTop: '6px' }}>
                  {quality.summary}
                </p>
              </div>
            )}

            {/* フェーズ内訳 */}
            <div style={{ background: '#fff', border: '1px solid #F5EEF0',
              borderRadius: '14px', padding: '12px 14px' }}>
              <p style={{ fontSize: '10px', color: '#C8A8B0', marginBottom: '8px', fontWeight: 600 }}>
                フェーズ内訳
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {phases.map(phase => {
                  const count = summary.phaseBreakdown[phase]
                  if (count === 0) return null
                  return (
                    <div key={phase} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <PhaseBadge phase={phase} />
                      <span style={{ fontSize: '11px', color: '#5C4033', fontFamily: 'Inter, sans-serif',
                        fontWeight: 600 }}>{count}名</span>
                    </div>
                  )
                })}
              </div>
              {summary.topTreatments.length > 0 && (
                <p style={{ fontSize: '10px', color: '#C8A8B0', marginTop: '8px' }}>
                  人気施術: {summary.topTreatments.join(' / ')}
                </p>
              )}
            </div>

            {/* 顧客一覧プレビュー */}
            <div style={{ background: '#fff', border: '1px solid #F5EEF0',
              borderRadius: '14px', overflow: 'hidden' }}>
              <div style={{ padding: '10px 14px', borderBottom: '1px solid #F5EEF0',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <p style={{ fontSize: '10px', color: '#C8A8B0', fontWeight: 600 }}>
                  顧客プレビュー
                </p>
                <span style={{ fontSize: '10px', color: '#C8A8B0' }}>
                  {result.customers.length}名
                </span>
              </div>
              {displayCustomers.map((c, i) => (
                <div key={c.nameHash} style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '9px 14px',
                  borderBottom: i < displayCustomers.length - 1 ? '1px solid #F5EEF0' : 'none',
                  background: i % 2 === 0 ? '#fff' : '#FFFBF8',
                }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#5C4033',
                    minWidth: '72px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.displayName}
                  </span>
                  <span style={{ fontSize: '10px', color: '#9F7E6C', minWidth: '36px' }}>
                    {c.visits}回
                  </span>
                  <span style={{ fontSize: '10px', color: '#9F7E6C', flex: 1, fontFamily: 'Inter, sans-serif' }}>
                    {formatYen(c.totalSales)}
                  </span>
                  <span style={{ fontSize: '10px', color: '#9F7E6C', minWidth: '28px', textAlign: 'right' }}>
                    {c.score}pt
                  </span>
                  <PhaseBadge phase={c.phase} />
                </div>
              ))}
              {result.customers.length > 5 && (
                <button onClick={() => setShowAll(v => !v)}
                  style={{ width: '100%', padding: '8px', background: 'none', border: 'none',
                    cursor: 'pointer', fontSize: '11px', color: '#F56E8B', fontWeight: 600 }}>
                  {showAll ? '▲ 折りたたむ' : `▼ 全${result.customers.length}名を表示`}
                </button>
              )}
            </div>

            {/* 取込実行ボタン */}
            <motion.button whileTap={{ scale: 0.97 }}
              onClick={handleImport}
              style={{
                width: '100%', padding: '14px',
                background: 'linear-gradient(135deg, #F56E8B, #F0487A)',
                border: 'none', borderRadius: '14px', cursor: 'pointer',
                color: '#fff', fontSize: '13px', fontWeight: 700,
                boxShadow: '0 6px 20px rgba(245,110,139,0.35)',
              }}>
              📥 取込実行（{result.customers.length}名）
            </motion.button>
            <p style={{ fontSize: '9px', color: '#C8A8B0', textAlign: 'center' }}>
              DEMO_MODE=true の場合は保存をスキップします
            </p>

          </motion.div>
        )}

      </AnimatePresence>
    </div>
  )
}
