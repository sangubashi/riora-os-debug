'use client'
/**
 * ProposalFeedbackAnalyticsScreen.tsx — AI提案分析(AI提案学習Phase2・管理者専用)
 *
 * スタッフが提案パネルで押した👍👎(brain_pattern_fire_log.decision_record.staffFeedback)を
 * 提案種類別・パターン別に集計して一覧表示するだけの「見える化」画面。
 * PatternScorer/ProposalEngineへの接続、ランキング化、学習利用は一切行わない。
 */
import { useEffect } from 'react'
import { Loader2, Sparkles, AlertTriangle } from 'lucide-react'
import { useProposalFeedbackAnalyticsStore, type ProposalFeedbackRange } from '@/store/useProposalFeedbackAnalyticsStore'
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

const thStyle: React.CSSProperties = {
  padding: '8px 12px', textAlign: 'right', fontSize: '11px', fontWeight: 700, color: '#9F7E6C',
  borderBottom: '1px solid #F0DEE2', whiteSpace: 'nowrap',
}
const thLeftStyle: React.CSSProperties = { ...thStyle, textAlign: 'left' }
const tdStyle: React.CSSProperties = { padding: '10px 12px', textAlign: 'right', fontSize: '13px', color: '#5C4033' }
const tdLeftStyle: React.CSSProperties = { ...tdStyle, textAlign: 'left', fontWeight: 700 }

export default function ProposalFeedbackAnalyticsScreen() {
  const { byKind, byPattern, range, truncated, isLoading, error, fetchAnalytics } = useProposalFeedbackAnalyticsStore()

  useEffect(() => {
    fetchAnalytics(DEMO_STORE_ID, '30d')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '16px', maxWidth: '820px' }}>
      <div>
        <p style={{ fontSize: '10px', fontWeight: 700, color: '#C8A8B0', letterSpacing: '0.1em', marginBottom: '2px' }}>
          AI提案学習 Phase2
        </p>
        <h1 style={{ fontSize: '18px', fontWeight: 700, color: '#5C4033', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Sparkles size={17} /> AI提案分析
        </h1>
        <p style={{ fontSize: '12px', color: '#9F7E6C', marginTop: '4px' }}>
          スタッフが提案パネルで押した👍👎の集計です(見える化のみ・ランキングやAI提案の判定には使用していません)。
          👍率60%未満はオレンジ、40%未満は赤で表示します。
        </p>
      </div>

      <div style={{ display: 'flex', gap: '6px' }}>
        {RANGE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => fetchAnalytics(DEMO_STORE_ID, opt.value)}
            disabled={isLoading}
            style={{
              fontSize: '12px', fontWeight: 700, padding: '6px 14px', borderRadius: '999px',
              border: `1px solid ${range === opt.value ? '#D98292' : '#F0DEE2'}`,
              color: range === opt.value ? '#fff' : '#9F7E6C',
              background: range === opt.value ? '#D98292' : '#fff',
              cursor: isLoading ? 'default' : 'pointer',
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {truncated && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#E08A3C' }}>
          <AlertTriangle size={13} />
          データが多いため一部のみ表示しています。期間を絞り込むと正確な集計になります。
        </div>
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
