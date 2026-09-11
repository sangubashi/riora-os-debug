'use client'
/**
 * IpadStaffKarteView.tsx — iPad専用スタッフカルテ画面(PHASE IPAD-1・2026-09-11)。
 *
 * 旧CustomerBottomSheetを置き換えるものではなく、並行稼働の試験画面として追加する。
 * CustomerBottomSheet本体のstate/useEffectには一切触れず、customerId/customerNameのみを
 * 受け取る自己完結コンポーネント(CustomerModeViewと同じ設計方針)。
 *
 * 今回のスコープ(🟢項目のみ・READ ONLY調査2026-09-11で合意):
 *   左カラム: 重要事項・目標
 *   右カラム: 写真カルテ(正面/左45/右45、前回|今回比較)・肌の特徴タグ(簡易版)・
 *             今日の施術(自由記述、手順テンプレート化はしない)・次回の目安
 * 前回の施術・AI接客ポイント・次回提案は次フェーズ(🟡項目)のため、この画面にはまだ無い。
 *
 * 写真比較UIはCustomerModeViewと共有(src/components/customer/shared/PhotoCompareKit.tsx)。
 */
import { useState } from 'react'
import { Flower2, CalendarDays, X } from 'lucide-react'
import { useIpadKarteData, IPAD_KARTE_ANGLES, type IpadKarteAngleId } from './ipadKarteData'
import { PALETTE, headingFont, Card, PhotoPanel, SkinTagRow, InfoBarItem } from '@/components/customer/shared/PhotoCompareKit'

interface Props {
  customerId: string
  customerName: string
  onClose: () => void
}

export default function IpadStaffKarteView({ customerId, customerName, onClose }: Props) {
  const data = useIpadKarteData(customerId)
  const [angle, setAngle] = useState<IpadKarteAngleId>('face_front')
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  const pair = data.anglePairs[angle]
  const currentUrl = pair?.current ? data.photoUrls[pair.current.id] : undefined
  const referenceUrl = pair?.reference ? data.photoUrls[pair.reference.id] : undefined

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: PALETTE.bg, display: 'flex', flexDirection: 'column' }}>
      {/* ── ヘッダー ── */}
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
          padding: 'max(20px, calc(env(safe-area-inset-top) + 14px)) 28px 16px',
          background: PALETTE.bg,
          borderBottom: `1px solid ${PALETTE.border}`,
        }}
      >
        <p
          style={{
            margin: 0, display: 'flex', alignItems: 'center', gap: '6px',
            fontSize: '20px', color: PALETTE.gold, letterSpacing: '0.01em',
            fontFamily: headingFont.style.fontFamily,
          }}
        >
          <Flower2 size={16} strokeWidth={1.4} color={PALETTE.gold} />
          Salon Riora
          <span style={{ fontSize: '11px', color: PALETTE.muted, marginLeft: '8px', fontWeight: 400 }}>
            iPadカルテ(β)
          </span>
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <p style={{ margin: 0, fontSize: '13px', letterSpacing: '0.04em', color: PALETTE.text, whiteSpace: 'nowrap' }}>
            {customerName}様
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="iPadカルテを閉じる"
            style={{
              width: '44px', height: '44px', borderRadius: '50%', flexShrink: 0,
              background: PALETTE.card, border: `1.5px solid ${PALETTE.gold}`, color: PALETTE.text,
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            }}
          >
            <X size={20} strokeWidth={2.2} />
          </button>
        </div>
      </div>

      {/* ── 本体(2カラム) ── */}
      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        {data.loading ? (
          <p style={{ textAlign: 'center', color: PALETTE.muted, fontSize: '13px', padding: '48px 0' }}>
            読み込み中…
          </p>
        ) : (
          <div
            style={{
              maxWidth: '1280px', margin: '0 auto', padding: '24px',
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px',
              alignItems: 'start',
            }}
          >
            {/* ── 左カラム ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {data.contraindications.length > 0 && (
                <Card title="⚠ 重要事項">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {data.contraindications.map(ci => (
                      <div key={ci.id}>
                        <p style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: PALETTE.text }}>
                          {ci.title}
                        </p>
                        {ci.description && (
                          <p style={{ margin: '4px 0 0', fontSize: '12px', color: PALETTE.muted, lineHeight: 1.6 }}>
                            {ci.description}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {!!data.goalNote?.trim() && (
                <Card title="🎯 目標">
                  <p style={{ margin: 0, fontSize: '14px', color: PALETTE.text, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
                    {data.goalNote}
                  </p>
                </Card>
              )}

              {data.contraindications.length === 0 && !data.goalNote?.trim() && (
                <Card title="重要事項・目標">
                  <p style={{ margin: 0, fontSize: '13px', color: PALETTE.muted }}>
                    登録されている情報はありません
                  </p>
                </Card>
              )}
            </div>

            {/* ── 右カラム ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <Card title="📷 写真カルテ（前回｜今回）">
                <div style={{ display: 'flex', gap: '24px', borderBottom: `1px solid ${PALETTE.border}`, marginBottom: '16px' }}>
                  {IPAD_KARTE_ANGLES.map(a => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setAngle(a.id)}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        padding: '0 0 10px', fontSize: '13px', letterSpacing: '0.06em',
                        color: angle === a.id ? PALETTE.text : PALETTE.muted,
                        borderBottom: angle === a.id ? `2px solid ${PALETTE.gold}` : '2px solid transparent',
                        fontFamily: headingFont.style.fontFamily,
                      }}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                  <PhotoPanel
                    label="前回"
                    url={referenceUrl}
                    visitCountAt={pair?.reference?.visitCountAt ?? null}
                    visitDate={pair?.reference?.visitDate ?? pair?.reference?.takenAt ?? null}
                    emptyText="前回の写真はまだありません"
                    onExpand={referenceUrl ? () => setLightboxUrl(referenceUrl) : undefined}
                  />
                  <PhotoPanel
                    label="今回"
                    url={currentUrl}
                    visitCountAt={pair?.current?.visitCountAt ?? null}
                    visitDate={pair?.current?.visitDate ?? pair?.current?.takenAt ?? null}
                    emptyText="本日未撮影"
                    onExpand={currentUrl ? () => setLightboxUrl(currentUrl) : undefined}
                  />
                </div>
              </Card>

              {data.currentSkinTags.length > 0 && (
                <Card title="✨ 肌の特徴">
                  <SkinTagRow tags={data.currentSkinTags} />
                </Card>
              )}

              {data.todayTreatmentPoints.length > 0 && (
                <Card title="✂ 今日の施術">
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {data.todayTreatmentPoints.map((point, i) => (
                      <span
                        key={`${point}-${i}`}
                        style={{
                          fontSize: '12px', color: PALETTE.text, background: PALETTE.bg,
                          border: `1px solid ${PALETTE.border}`, borderRadius: '999px', padding: '6px 14px',
                        }}
                      >
                        {point}
                      </span>
                    ))}
                  </div>
                </Card>
              )}

              {data.returnTiming && (
                <div
                  style={{
                    background: PALETTE.card, border: `1px solid ${PALETTE.border}`,
                    borderRadius: '18px', boxShadow: PALETTE.shadow,
                  }}
                >
                  <InfoBarItem icon={CalendarDays} label="次回の目安" value={data.returnTiming.label} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── 拡大表示 ── */}
      {lightboxUrl && (
        <div
          onClick={() => setLightboxUrl(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 320, background: 'rgba(30,24,16,0.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxUrl}
            alt=""
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: '8px' }}
          />
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            aria-label="閉じる"
            style={{
              position: 'absolute', top: 'max(20px, env(safe-area-inset-top))', right: '24px',
              width: '40px', height: '40px', borderRadius: '50%',
              background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            }}
          >
            <X size={18} />
          </button>
        </div>
      )}
    </div>
  )
}
