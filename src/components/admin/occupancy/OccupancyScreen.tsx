'use client'
/**
 * OccupancyScreen.tsx — 稼働率分析(画面⑤・MD-5・管理者専用)
 *
 * 設計根拠: docs/architecture/Riora_Management_Dashboard_Architecture_v2.0.md 画面⑤
 *
 * 表示は①スタッフ別稼働状況/②曜日別来店数/③時間帯別来店数/④稼働率推移のみ
 * (ユーザー指示・2026-06-23)。③④は既存テーブルだけでは算出不可能なことをDB確認済みのため、
 * ダミーデータで埋めず「取得不可」セクションとして理由を表示する。閲覧専用(編集機能なし)。
 */
import { useEffect } from 'react'
import { Loader2, Users, CalendarDays, Clock, TrendingUp, AlertCircle } from 'lucide-react'
import { useOccupancyStore } from '@/store/useOccupancyStore'
import { DEMO_STORE_ID } from '@/lib/constants'

const DAY_LABEL: Record<string, string> = {
  mon: '月', tue: '火', wed: '水', thu: '木', fri: '金', sat: '土', sun: '日',
}

function formatYen(n: number): string {
  return `¥${n.toLocaleString('ja-JP')}`
}

function formatPercent(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`
}

// スタッフ分析(MD-4・StaffAnalyticsScreen.tsx)のformatGrowthと同じ配色規約
// (プラス緑#3C9D5C・マイナス赤#D14F4F・0はグレー#9F7E6C)を踏襲する。
function diffColor(value: number): string {
  if (value > 0) return '#3C9D5C'
  if (value < 0) return '#D14F4F'
  return '#9F7E6C'
}

function formatCountDiff(value: number): string {
  return value === 0 ? '±0件' : `${value > 0 ? '+' : ''}${value}件`
}

function formatYenDiff(value: number): string {
  if (value === 0) return '±¥0'
  return `${value > 0 ? '+' : '-'}¥${Math.abs(value).toLocaleString('ja-JP')}`
}

function formatPercentDiff(value: number): string {
  const pct = Math.round(value * 100)
  return pct === 0 ? '±0%' : `${pct > 0 ? '+' : ''}${pct}%`
}

// 稼働率はseat_capacity未整備のため常にnullで返ってくる(OccupancyRepo参照)。
// nominationRateのformatPercentの「—」(来店0件でrateが定義できない)とは意味が異なる
// (「今月の実データが無い」ではなく「算出式自体が未整備」)ため、文言を分けて表示する。
function formatOccupancyRate(rate: number | null): string {
  return rate === null ? 'データ未整備' : `${Math.round(rate * 100)}%`
}

function formatOccupancyRateDiff(diff: number | null): string {
  return diff === null ? 'データ未整備' : formatPercentDiff(diff)
}

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

function UnavailableNotice({ reason }: { reason: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '12px 14px',
      background: '#FFF8F0', border: '1px solid #F4E4C2', borderRadius: '12px',
    }}>
      <AlertCircle size={14} color="#C9A055" style={{ flexShrink: 0, marginTop: '1px' }} />
      <p style={{ fontSize: '11px', color: '#9F7E6C', lineHeight: 1.6 }}>取得不可: {reason}</p>
    </div>
  )
}

export default function OccupancyScreen() {
  const { data, isLoading, error, fetchOccupancy } = useOccupancyStore()

  useEffect(() => {
    fetchOccupancy(DEMO_STORE_ID)
  }, [fetchOccupancy])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '16px', maxWidth: '640px' }}>
      <div>
        <p style={{ fontSize: '10px', fontWeight: 700, color: '#C8A8B0', letterSpacing: '0.1em', marginBottom: '2px' }}>
          画面⑤ MD-5
        </p>
        <h1 style={{ fontSize: '18px', fontWeight: 700, color: '#5C4033' }}>稼働率分析</h1>
        <p style={{ fontSize: '12px', color: '#9F7E6C', marginTop: '4px' }}>閲覧専用です(編集はできません)。</p>
      </div>

      {isLoading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 0', color: '#C8A8B0' }}>
          <Loader2 size={18} className="animate-spin" style={{ marginRight: '8px' }} />
          読み込み中...
        </div>
      )}

      {error && (
        <div style={{ padding: '16px', color: '#D14F4F', fontSize: '13px' }}>
          稼働率分析の取得に失敗しました: {error}
        </div>
      )}

      {!isLoading && data && (
        <>
          {/* ① スタッフ別稼働状況 */}
          <SectionCard title="① スタッフ別稼働状況" icon={<Users size={15} color="#D98292" />}>
            {data.staffOccupancy.length === 0 ? (
              <p style={{ fontSize: '12px', color: '#C8A8B0' }}>スタッフが登録されていません</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {data.staffOccupancy.map((s) => (
                  <div key={s.staffId} style={{
                    padding: '14px 16px', background: '#FFF8F7', borderRadius: '14px', border: '1px solid #F5EEF0',
                  }}>
                    <p style={{ fontSize: '14px', fontWeight: 700, color: '#5C4033', marginBottom: '10px' }}>
                      {s.staffName}
                    </p>

                    {/* 今月の実績(最大表示) */}
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
                      <div style={{ flex: 1, minWidth: '90px' }}>
                        <p style={{ fontSize: '10px', color: '#C8A8B0', marginBottom: '2px' }}>今月来店数</p>
                        <p style={{ fontSize: '20px', fontWeight: 700, color: '#5C4033', fontFamily: 'Inter, sans-serif' }}>
                          {s.visitCount}件
                        </p>
                      </div>
                      <div style={{ flex: 1, minWidth: '90px' }}>
                        <p style={{ fontSize: '10px', color: '#C8A8B0', marginBottom: '2px' }}>今月売上</p>
                        <p style={{ fontSize: '20px', fontWeight: 700, color: '#5C4033', fontFamily: 'Inter, sans-serif' }}>
                          {formatYen(s.sales)}
                        </p>
                      </div>
                      <div style={{ flex: 1, minWidth: '90px' }}>
                        <p style={{ fontSize: '10px', color: '#C8A8B0', marginBottom: '2px' }}>今月指名率</p>
                        <p style={{ fontSize: '20px', fontWeight: 700, color: '#5C4033', fontFamily: 'Inter, sans-serif' }}>
                          {formatPercent(s.nominationRate)}
                        </p>
                      </div>
                      <div style={{ flex: 1, minWidth: '90px' }}>
                        <p style={{ fontSize: '10px', color: '#C8A8B0', marginBottom: '2px' }}>今月稼働率</p>
                        <p style={{ fontSize: '20px', fontWeight: 700, color: '#5C4033', fontFamily: 'Inter, sans-serif' }}>
                          {formatOccupancyRate(s.occupancyRate)}
                        </p>
                      </div>
                    </div>

                    {/* 先月比較(小さめ表示) */}
                    <div style={{ paddingTop: '10px', borderTop: '1px solid #F0E4E8' }}>
                      <p style={{ fontSize: '10px', color: '#C8A8B0', marginBottom: '4px' }}>先月比較</p>
                      {s.comparison === null ? (
                        <p style={{ fontSize: '11px', color: '#9F7E6C' }}>比較データなし</p>
                      ) : (
                        <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '11px', color: diffColor(s.comparison.visitCountDiff) }}>
                            来店 {formatCountDiff(s.comparison.visitCountDiff)}
                          </span>
                          <span style={{ fontSize: '11px', color: diffColor(s.comparison.salesDiff) }}>
                            売上 {formatYenDiff(s.comparison.salesDiff)}
                          </span>
                          <span style={{ fontSize: '11px', color: diffColor(s.comparison.nominationRateDiff) }}>
                            指名率 {formatPercentDiff(s.comparison.nominationRateDiff)}
                          </span>
                          <span style={{ fontSize: '11px', color: s.comparison.occupancyRateDiff === null ? '#C8A8B0' : diffColor(s.comparison.occupancyRateDiff) }}>
                            稼働率 {formatOccupancyRateDiff(s.comparison.occupancyRateDiff)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* ② 曜日別来店数 */}
          <SectionCard title="② 曜日別来店数" icon={<CalendarDays size={15} color="#D98292" />}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', height: '110px' }}>
              {(() => {
                const max = Math.max(...data.dayOfWeekVisits.map((d) => d.visitCount), 1)
                return data.dayOfWeekVisits.map((d) => (
                  <div key={d.dayOfWeek} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', height: '100%' }}>
                    <span style={{ fontSize: '10px', color: '#5C4033', fontWeight: 700 }}>{d.visitCount}</span>
                    <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', width: '100%' }}>
                      <div style={{
                        width: '100%', borderRadius: '4px 4px 0 0',
                        height: `${Math.max((d.visitCount / max) * 100, d.visitCount > 0 ? 4 : 1)}%`,
                        background: d.dayOfWeek === 'sat' || d.dayOfWeek === 'sun' ? '#E8A8B8' : 'linear-gradient(180deg, #F56E8B, #F0487A)',
                      }} />
                    </div>
                    <span style={{ fontSize: '10px', color: '#9F7E6C' }}>{DAY_LABEL[d.dayOfWeek]}</span>
                  </div>
                ))
              })()}
            </div>
          </SectionCard>

          {/* ③ 時間帯別来店数 */}
          <SectionCard title="③ 時間帯別来店数" icon={<Clock size={15} color="#D98292" />}>
            {data.hourlyVisits.available ? (
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '110px', overflowX: 'auto' }}>
                {(() => {
                  const points = data.hourlyVisits.data
                  const max = Math.max(...points.map((h) => h.visitCount), 1)
                  return points.map((h) => (
                    <div key={h.hour} style={{ flex: 1, minWidth: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', height: '100%' }}>
                      {h.visitCount > 0 && (
                        <span style={{ fontSize: '9px', color: '#5C4033', fontWeight: 700 }}>{h.visitCount}</span>
                      )}
                      <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', width: '100%' }}>
                        <div style={{
                          width: '100%', borderRadius: '3px 3px 0 0',
                          height: `${Math.max((h.visitCount / max) * 100, h.visitCount > 0 ? 4 : 1)}%`,
                          background: 'linear-gradient(180deg, #F56E8B, #F0487A)',
                        }} />
                      </div>
                      <span style={{ fontSize: '8px', color: '#C8A8B0' }}>{h.hour}</span>
                    </div>
                  ))
                })()}
              </div>
            ) : (
              <UnavailableNotice reason={data.hourlyVisits.reason} />
            )}
          </SectionCard>

          {/* ④ 稼働分数推移 */}
          <SectionCard title="④ 稼働分数推移(直近30日)" icon={<TrendingUp size={15} color="#D98292" />}>
            {data.occupancyTrend.available ? (
              <>
                {data.occupancyTrend.note && (
                  <p style={{ fontSize: '10px', color: '#C9A055', marginBottom: '10px' }}>{data.occupancyTrend.note}</p>
                )}
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '100px', overflowX: 'auto' }}>
                  {(() => {
                    const points = data.occupancyTrend.data
                    const max = Math.max(...points.map((p) => p.occupiedMinutes), 1)
                    return points.map((p) => (
                      <div key={p.date} title={`${p.date}: ${p.occupiedMinutes}分`}
                        style={{ flex: 1, minWidth: '5px', height: '100%', display: 'flex', alignItems: 'flex-end' }}>
                        <div style={{
                          width: '100%', borderRadius: '2px 2px 0 0',
                          height: `${Math.max((p.occupiedMinutes / max) * 100, 2)}%`,
                          background: 'linear-gradient(180deg, #F56E8B, #F0487A)',
                        }} />
                      </div>
                    ))
                  })()}
                </div>
              </>
            ) : (
              <UnavailableNotice reason={data.occupancyTrend.reason} />
            )}
          </SectionCard>
        </>
      )}
    </div>
  )
}
