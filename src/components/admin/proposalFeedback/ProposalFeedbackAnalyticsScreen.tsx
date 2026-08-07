'use client'
/**
 * ProposalFeedbackAnalyticsScreen.tsx — AI提案分析(AI提案学習Phase2 + AI提案分析MVP・管理者専用)
 *
 * 2つの独立したstoreを同じ画面にまとめて表示する:
 *   - useProposalFeedbackAnalyticsStore: スタッフが提案パネルで押した👍👎の集計(Phase2)。
 *   - useProposalAnalyticsStore: AI提案表示数/実施率/施術一致率/月別推移/パターン別成功率
 *     (AI提案分析MVP、docs/AI_PROPOSAL_ANALYTICS_DASHBOARD_DESIGN.md §4)。
 * いずれも既存データの集計・見える化のみ。PatternScorer/ProposalEngineへの接続、
 * ランキング化、学習利用は一切行わない。
 */
import { useEffect } from 'react'
import { Loader2, Sparkles, AlertTriangle } from 'lucide-react'
import { useProposalFeedbackAnalyticsStore, type ProposalFeedbackRange } from '@/store/useProposalFeedbackAnalyticsStore'
import { useProposalAnalyticsStore } from '@/store/useProposalAnalyticsStore'
import { DEMO_STORE_ID } from '@/lib/constants'

const RANGE_OPTIONS: { value: ProposalFeedbackRange; label: string }[] = [
  { value: '30d', label: '直近30日' },
  { value: '90d', label: '直近90日' },
  { value: 'all', label: '全期間' },
]

const KIND_LABELS: Record<string, string> = {
  homecare: 'ホームケア',
  pack: 'パック',
  rebooking: '再予約',
  upsell: 'アップセル',
  subscription: 'サブスク',
  none: 'なし',
}

function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind
}

/** 👍率が低い提案だけ目立たせる(60%未満オレンジ・40%未満赤・見える化のみ)。 */
function rateColor(goodRate: number, count: number): string | undefined {
  if (count === 0) return undefined
  if (goodRate < 40) return '#D14F4F'
  if (goodRate < 60) return '#E08A3C'
  return undefined
}

function RateCell({ goodRate, count }: { goodRate: number; count: number }) {
  const color = rateColor(goodRate, count)
  return (
    <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: color ? 700 : 600, color: color ?? '#5C4033' }}>
      {count === 0 ? '—' : `${goodRate}%`}
    </td>
  )
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #F5EEF0', borderRadius: '14px',
      padding: '12px 16px', minWidth: '150px', flex: '1 1 150px',
    }}>
      <p style={{ fontSize: '11px', color: '#9F7E6C', fontWeight: 700, marginBottom: '4px' }}>{label}</p>
      <p style={{ fontSize: '22px', color: '#5C4033', fontWeight: 700 }}>{value}</p>
      {sub && <p style={{ fontSize: '10px', color: '#C8A8B0', marginTop: '2px' }}>{sub}</p>}
    </div>
  )
}

const thStyle: React.CSSProperties = {
  padding: '8px 12px', textAlign: 'right', fontSize: '11px', fontWeight: 700, color: '#9F7E6C',
  borderBottom: '1px solid #F0DEE2', whiteSpace: 'nowrap',
}
const thLeftStyle: React.CSSProperties = { ...thStyle, textAlign: 'left' }
const tdStyle: React.CSSProperties = { padding: '10px 12px', textAlign: 'right', fontSize: '13px', color: '#5C4033' }
const tdLeftStyle: React.CSSProperties = { ...tdStyle, textAlign: 'left', fontWeight: 700 }

export default function ProposalFeedbackAnalyticsScreen() {
  const { byKind, byPattern, range, truncated, isLoading, error, fetchAnalytics } = useProposalFeedbackAnalyticsStore()
  const {
    summary, monthlyTrend, patternSuccessRate,
    truncated: analyticsTruncated, isLoading: analyticsLoading, error: analyticsError,
    fetchProposalAnalytics,
  } = useProposalAnalyticsStore()

  useEffect(() => {
    fetchAnalytics(DEMO_STORE_ID, '30d')
    fetchProposalAnalytics(DEMO_STORE_ID, '30d')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleRangeChange = (value: ProposalFeedbackRange) => {
    fetchAnalytics(DEMO_STORE_ID, value)
    fetchProposalAnalytics(DEMO_STORE_ID, value)
  }

  const anyLoading = isLoading || analyticsLoading
  const maxDisplayCount = Math.max(1, ...monthlyTrend.map((p) => p.displayCount))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '16px', maxWidth: '820px' }}>
      <div>
        <p style={{ fontSize: '10px', fontWeight: 700, color: '#C8A8B0', letterSpacing: '0.1em', marginBottom: '2px' }}>
          AI提案分析
        </p>
        <h1 style={{ fontSize: '18px', fontWeight: 700, color: '#5C4033', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Sparkles size={17} /> AI提案分析
        </h1>
        <p style={{ fontSize: '12px', color: '#9F7E6C', marginTop: '4px' }}>
          AI提案の利用状況(表示数・実施率・パターン別成功率)と、スタッフが提案パネルで押した
          👍👎の集計です(いずれも見える化のみ・ランキングやAI提案の判定には使用していません)。
          👍率60%未満はオレンジ、40%未満は赤で表示します。
        </p>
      </div>

      <div style={{ display: 'flex', gap: '6px' }}>
        {RANGE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => handleRangeChange(opt.value)}
            disabled={anyLoading}
            style={{
              fontSize: '12px', fontWeight: 700, padding: '6px 14px', borderRadius: '999px',
              border: `1px solid ${range === opt.value ? '#D98292' : '#F0DEE2'}`,
              color: range === opt.value ? '#fff' : '#9F7E6C',
              background: range === opt.value ? '#D98292' : '#fff',
              cursor: anyLoading ? 'default' : 'pointer',
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {(truncated || analyticsTruncated) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#E08A3C' }}>
          <AlertTriangle size={13} />
          データが多いため一部のみ表示しています。期間を絞り込むと正確な集計になります。
        </div>
      )}

      {analyticsLoading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 0', color: '#C8A8B0' }}>
          <Loader2 size={18} className="animate-spin" style={{ marginRight: '8px' }} />
          読み込み中...
        </div>
      )}

      {analyticsError && (
        <div style={{ padding: '16px', color: '#D14F4F', fontSize: '13px' }}>
          分析データの取得に失敗しました: {analyticsError}
        </div>
      )}

      {!analyticsLoading && !analyticsError && summary && (
        <>
          <section>
            <h2 style={{ fontSize: '13px', fontWeight: 700, color: '#5C4033', marginBottom: '8px' }}>サマリー</h2>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
              <SummaryCard label="AI提案表示数" value={`${summary.displayCount}件`} />
              <SummaryCard
                label="AI提案実施率"
                value={`${summary.executionRatePct}%`}
                sub={`${summary.executedCount}/${summary.outcomeCount}件(来店・会計データと紐付いた提案のうち)`}
              />
              <SummaryCard label="AI提案→施術一致率" value={`${summary.treatmentMatchRatePct}%`} sub="現状は実施率と同じ定義" />
            </div>
            {summary.kindBreakdown.length === 0 ? (
              <p style={{ fontSize: '12px', color: '#C8A8B0' }}>まだデータがありません</p>
            ) : (
              <div style={{ background: '#fff', border: '1px solid #F5EEF0', borderRadius: '14px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#FFF8F7' }}>
                      <th style={thLeftStyle}>提案種類</th>
                      <th style={thStyle}>件数</th>
                      <th style={thStyle}>実施数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.kindBreakdown.map((row) => (
                      <tr key={row.proposalKind} style={{ borderTop: '1px solid #F5EEF0' }}>
                        <td style={tdLeftStyle}>{kindLabel(row.proposalKind)}</td>
                        <td style={tdStyle}>{row.count}</td>
                        <td style={tdStyle}>{row.executedCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section>
            <h2 style={{ fontSize: '13px', fontWeight: 700, color: '#5C4033', marginBottom: '8px' }}>月別推移</h2>
            {monthlyTrend.length === 0 ? (
              <p style={{ fontSize: '12px', color: '#C8A8B0' }}>まだデータがありません</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {monthlyTrend.map((pt) => (
                  <div key={pt.month}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#9F7E6C', marginBottom: '3px' }}>
                      <span>{pt.month}</span>
                      <span>表示{pt.displayCount}件 / 実施{pt.executedCount}件</span>
                    </div>
                    <div style={{ position: 'relative', height: '10px', background: '#F5EEF0', borderRadius: '6px', overflow: 'hidden' }}>
                      <div style={{ position: 'absolute', inset: 0, width: `${(pt.displayCount / maxDisplayCount) * 100}%`, background: '#F0DEE2' }} />
                      <div style={{ position: 'absolute', inset: 0, width: `${(pt.executedCount / maxDisplayCount) * 100}%`, background: '#D98292' }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 style={{ fontSize: '13px', fontWeight: 700, color: '#5C4033', marginBottom: '8px' }}>パターン別成功率</h2>
            {patternSuccessRate.length === 0 ? (
              <p style={{ fontSize: '12px', color: '#C8A8B0' }}>
                まだデータがありません(実施件数が一定数集まるまでbrain_pattern_step_statsに反映されません)
              </p>
            ) : (
              <div style={{ background: '#fff', border: '1px solid #F5EEF0', borderRadius: '14px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#FFF8F7' }}>
                      <th style={thLeftStyle}>パターン</th>
                      <th style={thLeftStyle}>顧客タイプ</th>
                      <th style={thLeftStyle}>接客スタイル</th>
                      <th style={thStyle}>実施数</th>
                      <th style={thStyle}>採用数</th>
                      <th style={thStyle}>成功率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {patternSuccessRate.map((row) => (
                      <tr key={`${row.candidateCode}:${row.customerType}:${row.staffStyle}`} style={{ borderTop: '1px solid #F5EEF0' }}>
                        <td style={tdLeftStyle}>{row.patternId}<span style={{ color: '#C8A8B0', fontWeight: 600 }}> step{row.stepNo}</span></td>
                        <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 600 }}>{row.customerType}</td>
                        <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 600 }}>{row.staffStyle}</td>
                        <td style={tdStyle}>{row.executedN}</td>
                        <td style={tdStyle}>{row.acceptedN}</td>
                        <td style={tdStyle}>{row.successRatePct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {isLoading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 0', color: '#C8A8B0' }}>
          <Loader2 size={18} className="animate-spin" style={{ marginRight: '8px' }} />
          読み込み中...
        </div>
      )}

      {error && (
        <div style={{ padding: '16px', color: '#D14F4F', fontSize: '13px' }}>
          分析データの取得に失敗しました: {error}
        </div>
      )}

      {!isLoading && !error && (
        <>
          <section>
            <h2 style={{ fontSize: '13px', fontWeight: 700, color: '#5C4033', marginBottom: '8px' }}>提案種類別</h2>
            {byKind.length === 0 ? (
              <p style={{ fontSize: '12px', color: '#C8A8B0' }}>まだフィードバックがありません</p>
            ) : (
              <div style={{ background: '#fff', border: '1px solid #F5EEF0', borderRadius: '14px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#FFF8F7' }}>
                      <th style={thLeftStyle}>提案種類</th>
                      <th style={thStyle}>提案回数</th>
                      <th style={thStyle}>👍</th>
                      <th style={thStyle}>👎</th>
                      <th style={thStyle}>👍率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byKind.map((row) => (
                      <tr key={row.proposalKind} style={{ borderTop: '1px solid #F5EEF0' }}>
                        <td style={tdLeftStyle}>{kindLabel(row.proposalKind)}</td>
                        <td style={tdStyle}>{row.count}</td>
                        <td style={tdStyle}>{row.good}</td>
                        <td style={tdStyle}>{row.bad}</td>
                        <RateCell goodRate={row.goodRate} count={row.count} />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section>
            <h2 style={{ fontSize: '13px', fontWeight: 700, color: '#5C4033', marginBottom: '8px' }}>パターン別</h2>
            {byPattern.length === 0 ? (
              <p style={{ fontSize: '12px', color: '#C8A8B0' }}>まだフィードバックがありません</p>
            ) : (
              <div style={{ background: '#fff', border: '1px solid #F5EEF0', borderRadius: '14px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#FFF8F7' }}>
                      <th style={thLeftStyle}>パターン</th>
                      <th style={thLeftStyle}>種類</th>
                      <th style={thStyle}>提案回数</th>
                      <th style={thStyle}>👍</th>
                      <th style={thStyle}>👎</th>
                      <th style={thStyle}>👍率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byPattern.map((row) => (
                      <tr key={`${row.patternId}::${row.stepNo}`} style={{ borderTop: '1px solid #F5EEF0' }}>
                        <td style={tdLeftStyle}>{row.patternId}<span style={{ color: '#C8A8B0', fontWeight: 600 }}> step{row.stepNo}</span></td>
                        <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 600 }}>{kindLabel(row.proposalKind)}</td>
                        <td style={tdStyle}>{row.count}</td>
                        <td style={tdStyle}>{row.good}</td>
                        <td style={tdStyle}>{row.bad}</td>
                        <RateCell goodRate={row.goodRate} count={row.count} />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
