'use client'
/**
 * CustomerProposalPanel.tsx — 顧客詳細からのAI提案パネル(AI提案本物化)
 *
 * 設計根拠: docs/ai/Riora_Proposal_Generator_Architecture_v2.0.md
 *
 * ProposalOrchestrator(実装済の決定論エンジン・LLM不使用)を呼び出した実際の結果を
 * 表示する。提案根拠(なぜ発火したか/避けること/決定打)・音声メモ連携状況・
 * LINE履歴・次回来店候補日を実データのまま表示する(固定文言・モックデータ禁止)。
 */
import { useEffect, useState } from 'react'
import { Loader2, Sparkles, AlertTriangle, CheckCircle2, MessageSquareWarning } from 'lucide-react'
import { useProposalStore } from '@/store/useProposalStore'

interface StaffOption { id: string; name: string }

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <p style={{ fontSize: '10px', fontWeight: 700, color: '#9F7E6C', marginBottom: '4px' }}>{title}</p>
      {children}
    </div>
  )
}

export default function CustomerProposalPanel({ storeId, customerId, customerName }: { storeId: string; customerId: string; customerName: string }) {
  const { result, isLoading, isSaving, error, saveSuccess, generate, save, reset } = useProposalStore()
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([])
  const [staffId, setStaffId] = useState('')

  useEffect(() => {
    reset()
    fetch(`/api/admin/staff-aliases?storeId=${encodeURIComponent(storeId)}`)
      .then((r) => r.json())
      .then((body) => {
        if (body.success !== false && body.staffOptions) {
          setStaffOptions(body.staffOptions)
          if (body.staffOptions.length > 0) setStaffId(body.staffOptions[0].id)
        }
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId])

  const handleGenerate = () => {
    if (!staffId) return
    generate(storeId, customerId, staffId)
  }

  const handleSave = () => {
    if (!staffId) return
    save(storeId, customerId, staffId)
  }

  const degraded = result && 'degraded' in result.proposal
  const proposal = result ? (degraded ? (result.proposal as { proposal: typeof result.proposal }).proposal : result.proposal) : null
  const mandatory = proposal && !('degraded' in proposal) ? proposal.inStore.mandatory : null
  const secondary = proposal && !('degraded' in proposal) ? proposal.inStore.secondary : null
  const explanation = proposal && !('degraded' in proposal) ? proposal.explanation : null
  const candidateDate = proposal && !('degraded' in proposal) ? proposal.inStore.candidateDate : null

  return (
    <div style={{ background: '#FFF8F7', border: '1px solid #F0DEE2', borderRadius: '14px', padding: '16px', marginTop: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
        <p style={{ fontSize: '13px', fontWeight: 700, color: '#5C4033' }}>{customerName} 様 — AI提案</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <select
            value={staffId}
            onChange={(e) => setStaffId(e.target.value)}
            style={{ fontSize: '12px', padding: '5px 8px', borderRadius: '8px', border: '1px solid #F0DEE2' }}
          >
            {staffOptions.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button
            onClick={handleGenerate}
            disabled={isLoading || !staffId}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', fontWeight: 700,
              color: '#fff', background: '#D98292', border: 'none', borderRadius: '10px', padding: '7px 14px',
              cursor: isLoading ? 'default' : 'pointer', opacity: isLoading ? 0.6 : 1,
            }}
          >
            <Sparkles size={13} />
            {isLoading ? '生成中...' : 'AI提案を生成'}
          </button>
        </div>
      </div>

      {error && <p style={{ fontSize: '12px', color: '#D14F4F', marginBottom: '8px' }}>提案生成エラー: {error}</p>}

      {result && (
        <>
          {degraded && (
            <p style={{ fontSize: '12px', color: '#D98292', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '5px' }}>
              <AlertTriangle size={13} /> エンジンが縮退動作しました: {(result.proposal as { reason: string }).reason}
            </p>
          )}

          <Section title="本日の提案(店内・必須枠)">
            {mandatory ? (
              <div style={{ background: '#fff', borderRadius: '10px', padding: '10px 12px', border: '1px solid #F5EEF0' }}>
                <p style={{ fontSize: '12px', fontWeight: 700, color: '#5C4033' }}>{mandatory.candidateCode}({mandatory.proposalKind}) — FireScore {Math.round(mandatory.fireScore)}点</p>
                <p style={{ fontSize: '12px', color: '#5C4033', marginTop: '4px', whiteSpace: 'pre-line' }}>{mandatory.adjustedScript}</p>
                <p style={{ fontSize: '11px', color: '#9F7E6C', marginTop: '4px' }}>決定打: {mandatory.decisiveFactor ?? '—'}</p>
              </div>
            ) : (
              <p style={{ fontSize: '12px', color: '#C8A8B0' }}>本日発火する提案はありません</p>
            )}
          </Section>

          {secondary && (
            <Section title="補助提案(非販売枠)">
              <div style={{ background: '#fff', borderRadius: '10px', padding: '10px 12px', border: '1px solid #F5EEF0' }}>
                <p style={{ fontSize: '12px', fontWeight: 700, color: '#5C4033' }}>{secondary.candidateCode}({secondary.proposalKind})</p>
                <p style={{ fontSize: '12px', color: '#5C4033', marginTop: '4px' }}>{secondary.adjustedScript}</p>
              </div>
            </Section>
          )}

          {candidateDate && (
            <Section title="次回来店候補日">
              <p style={{ fontSize: '12px', color: '#5C4033' }}>{candidateDate}</p>
            </Section>
          )}

          {explanation && (
            <Section title="提案根拠(スタッフ/マネージャー向け・顧客には見せない)">
              <div style={{ background: '#fff', borderRadius: '10px', padding: '10px 12px', border: '1px solid #F5EEF0', fontSize: '11px', color: '#5C4033', lineHeight: 1.6 }}>
                <p><strong>なぜ今日か:</strong> {explanation.staffLine1}</p>
                {explanation.staffAvoid && <p style={{ color: '#D14F4F' }}><strong>避けること:</strong> {explanation.staffAvoid}</p>}
                <p><strong>Q1 なぜ発火したか:</strong> {explanation.managerQ1}</p>
                <p><strong>Q2 なぜ他候補を落としたか:</strong> {explanation.managerQ2}</p>
                <p><strong>Q3 決定打:</strong> {explanation.managerQ3}</p>
              </div>
            </Section>
          )}

          <Section title="音声メモ連携(参考情報)">
            {result.voiceMemoContext.linkStatus === 'matched' ? (
              <div style={{ fontSize: '11px', color: '#5C4033' }}>
                {result.voiceMemoContext.contraindications.length > 0 && (
                  <p style={{ color: '#D14F4F', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <MessageSquareWarning size={12} /> 禁忌注意: {result.voiceMemoContext.contraindications.map((c) => c.title).join(' / ')}
                  </p>
                )}
                {result.voiceMemoContext.latestHandoverSummary && <p>引継ぎメモ: {result.voiceMemoContext.latestHandoverSummary}</p>}
                {result.voiceMemoContext.customerNotes.slice(0, 3).map((n, i) => <p key={i}>・{n.note}</p>)}
                {result.voiceMemoContext.customerNotes.length === 0 && !result.voiceMemoContext.latestHandoverSummary && <p style={{ color: '#C8A8B0' }}>記録された音声メモはありません</p>}
              </div>
            ) : (
              <p style={{ fontSize: '11px', color: '#C8A8B0' }}>
                {result.voiceMemoContext.linkStatus === 'ambiguous_match'
                  ? '同姓同名が複数件あり、音声メモを一意に紐付けできません'
                  : '音声メモ記録(別システム)に一致する顧客が見つかりません'}
              </p>
            )}
          </Section>

          <Section title="LINE履歴(参考情報)">
            <p style={{ fontSize: '11px', color: '#5C4033' }}>
              {result.lineHistoryContext.recentCount > 0
                ? `直近${result.lineHistoryContext.recentCount}件: ${result.lineHistoryContext.items.map((i) => i.scenarioCode).join(', ')}`
                : 'LINE配信履歴はありません'}
            </p>
          </Section>

          <button
            onClick={handleSave}
            disabled={isSaving || !mandatory}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', fontWeight: 700,
              color: '#D98292', background: '#fff', border: '1px solid #D98292', borderRadius: '10px',
              padding: '7px 14px', cursor: isSaving ? 'default' : 'pointer', opacity: isSaving || !mandatory ? 0.5 : 1,
            }}
          >
            {isSaving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
            {isSaving ? '保存中...' : '提案を記録する'}
          </button>
          {saveSuccess && <span style={{ marginLeft: '8px', fontSize: '11px', color: '#34D399' }}>保存しました</span>}
        </>
      )}
    </div>
  )
}
