'use client'
/**
 * CustomerModeView.tsx — 「お客様モード」画面(PHASE GUEST-MODE-1・2026-09-10)。
 *
 * スタッフがiPadをお客様に向けて、前回と今回のお肌の変化を一緒に確認するための
 * 専用画面。CustomerBottomSheet(スタッフ画面)とは完全に分離した独立コンポーネントで、
 * スタッフ専用コンポーネント(ContraindicationSection・AIProposalCard・
 * NextActionPanel・StaffProposalSection・LINE関連・CustomerRiskCard等)を
 * 一切importしない。これにより「お客様モードでは内部情報を描画しない」を、
 * CSSでの非表示ではなくコンポーネントツリー自体の分離で実現する
 * (ユーザー指示 2026-09-10)。AIProposalCardを一切importしていないため、
 * お客様モードを開いたことをきっかけに /api/proposals/fire が呼ばれることもない。
 *
 * データは既存API(customerModeData.ts参照)のみを再利用し、新規API・新規DB・
 * Storage変更は一切行わない。customerId/customerNameのみを受け取り、他は
 * 自前でfetchする自己完結コンポーネント(GoalSection等と同じ設計方針)。
 *
 * デザイン方針: アイボリー×ベージュ×ゴールド×ダークブラウン。大きな余白・細い境界線・
 * 控えめなシャドウ。業務アプリ感を避け、美容サロンらしい落ち着いた高級感を優先する。
 */
import { useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import {
  useCustomerModeData,
  CUSTOMER_MODE_ANGLES,
  type CustomerModeAngleId,
  type SkinTagChip,
} from './customerModeData'

const PALETTE = {
  bg: '#F7F2EA',
  card: '#FFFFFF',
  border: '#E8DFCF',
  gold: '#AD8A54',
  text: '#3E3226',
  muted: '#8A7A65',
  shadow: '0 4px 24px rgba(60,45,25,0.07)',
}

interface Props {
  customerId: string
  customerName: string
  onClose: () => void
}

export default function CustomerModeView({ customerId, customerName, onClose }: Props) {
  const data = useCustomerModeData(customerId)
  const [angle, setAngle] = useState<CustomerModeAngleId>('face_front')
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  const pair = data.anglePairs[angle]
  const currentUrl = pair?.current ? data.photoUrls[pair.current.id] : undefined
  const referenceUrl = pair?.reference ? data.photoUrls[pair.reference.id] : undefined

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: PALETTE.bg, display: 'flex', flexDirection: 'column' }}>
      {/* ── ヘッダー(常時表示) ── */}
      <div
        style={{
          flexShrink: 0,
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          alignItems: 'center',
          padding: 'max(20px, calc(env(safe-area-inset-top) + 14px)) 28px 16px',
          background: PALETTE.card,
          borderBottom: `1px solid ${PALETTE.border}`,
        }}
      >
        <div>
          <p style={{ margin: 0, fontSize: '19px', fontStyle: 'italic', fontWeight: 600, color: PALETTE.gold }}>
            ✿ Salon Riora
          </p>
          <p style={{ margin: '2px 0 0', fontSize: '10px', letterSpacing: '0.1em', color: PALETTE.muted }}>
            {customerName}様
          </p>
        </div>
        <p style={{ margin: 0, fontSize: '17px', fontWeight: 600, color: PALETTE.text, whiteSpace: 'nowrap' }}>
          お肌の変化を一緒に確認しましょう
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            aria-label="お客様モードを終了"
            style={{
              width: '40px', height: '40px', borderRadius: '50%',
              background: PALETTE.bg, border: `1px solid ${PALETTE.border}`, color: PALETTE.muted,
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            }}
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* ── スクロール領域(「1画面目」+「スクロール部分」を1つの連続スクロールにまとめる) ── */}
      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <div style={{ maxWidth: '980px', margin: '0 auto', padding: '24px 28px 48px' }}>

          {/* 角度タブ */}
          <div style={{ display: 'flex', gap: '32px', borderBottom: `1px solid ${PALETTE.border}`, marginBottom: '20px' }}>
            {CUSTOMER_MODE_ANGLES.map(a => (
              <button
                key={a.id}
                type="button"
                onClick={() => setAngle(a.id)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: '0 0 12px', fontSize: '15px', fontWeight: 600,
                  color: angle === a.id ? PALETTE.text : PALETTE.muted,
                  borderBottom: angle === a.id ? `2px solid ${PALETTE.gold}` : '2px solid transparent',
                }}
              >
                {a.label}
              </button>
            ))}
          </div>

          {data.loading ? (
            <p style={{ textAlign: 'center', color: PALETTE.muted, fontSize: '13px', padding: '48px 0' }}>
              読み込み中…
            </p>
          ) : (
            <>
              {/* 写真比較 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <PhotoPanel
                  label="前回"
                  url={referenceUrl}
                  visitCountAt={pair?.reference?.visitCountAt ?? null}
                  emptyText="前回の写真はまだありません"
                  onExpand={referenceUrl ? () => setLightboxUrl(referenceUrl) : undefined}
                />
                <PhotoPanel
                  label="今回"
                  url={currentUrl}
                  visitCountAt={pair?.current?.visitCountAt ?? null}
                  emptyText="まだ写真がありません"
                  onExpand={currentUrl ? () => setLightboxUrl(currentUrl) : undefined}
                />
              </div>

              {/* 肌状態タグ(前回/今回それぞれの上位2項目) */}
              {(data.previousSkinTags.length > 0 || data.currentSkinTags.length > 0) && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '12px' }}>
                  <SkinTagRow tags={data.previousSkinTags} />
                  <SkinTagRow tags={data.currentSkinTags} />
                </div>
              )}

              {/* 今回の施術 / 次回の目安 */}
              <div
                style={{
                  marginTop: '20px', background: PALETTE.card, border: `1px solid ${PALETTE.border}`,
                  borderRadius: '18px', boxShadow: PALETTE.shadow, display: 'flex', alignItems: 'stretch',
                }}
              >
                <InfoBarItem emoji="🌿" label="今回の施術" value={data.currentMenuName ?? '本日のメニューは準備中です'} />
                <div style={{ width: '1px', background: PALETTE.border }} />
                <InfoBarItem emoji="🗓" label="次回の目安" value={data.nextVisitLabel ?? 'ご来店後にご案内します'} />
              </div>
            </>
          )}

          {/* ── スクロール部分 ── */}
          {!data.loading && (
            <div style={{ marginTop: '36px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {data.homecareItems.length > 0 && (
                <Card title="今回のホームケア">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    {data.homecareItems.map(item => (
                      <div key={item.productName}>
                        <p style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: PALETTE.text }}>
                          {item.productName}
                        </p>
                        {(item.frequency || item.timing) && (
                          <p style={{ margin: '4px 0 0', fontSize: '12px', color: PALETTE.muted, lineHeight: 1.6 }}>
                            {[item.frequency, item.timing].filter(Boolean).join(' ・ ')}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {!!data.goalNote?.trim() && (
                <Card title="お客様の目標">
                  <p style={{ margin: 0, fontSize: '14px', color: PALETTE.text, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
                    「{data.goalNote}」
                  </p>
                </Card>
              )}

              {data.treatmentPoints.length > 0 && (
                <Card title="今回の施術ポイント">
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {data.treatmentPoints.map((point, i) => (
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
            </div>
          )}
        </div>
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

function PhotoPanel({
  label, url, visitCountAt, emptyText, onExpand,
}: {
  label: string
  url: string | undefined
  visitCountAt: number | null
  emptyText: string
  onExpand?: () => void
}) {
  return (
    <div>
      <div
        style={{
          position: 'relative', aspectRatio: '5 / 4', borderRadius: '16px', overflow: 'hidden',
          background: '#EFE8DA', border: `1px solid ${PALETTE.border}`,
        }}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <div
            style={{
              width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: PALETTE.muted, fontSize: '12px', textAlign: 'center', padding: '16px',
            }}
          >
            {emptyText}
          </div>
        )}
        <span
          style={{
            position: 'absolute', top: '12px', left: '12px',
            background: 'rgba(255,255,255,0.9)', color: PALETTE.text,
            fontSize: '12px', fontWeight: 700, padding: '4px 12px', borderRadius: '999px',
          }}
        >
          {label}
        </span>
        {onExpand && (
          <button
            type="button"
            onClick={onExpand}
            aria-label="拡大"
            style={{
              position: 'absolute', bottom: '12px', right: '12px',
              width: '36px', height: '36px', borderRadius: '50%',
              background: 'rgba(255,255,255,0.92)', border: 'none', color: PALETTE.text,
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
              fontSize: '14px', boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            }}
          >
            ⤢
          </button>
        )}
      </div>
      {visitCountAt != null && (
        <p style={{ textAlign: 'center', margin: '10px 0 0', fontSize: '12px', color: PALETTE.muted }}>
          来店{visitCountAt}回目
        </p>
      )}
    </div>
  )
}

function SkinTagRow({ tags }: { tags: SkinTagChip[] }) {
  if (tags.length === 0) return <div />
  return (
    <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
      {tags.map(tag => (
        <span
          key={tag.label}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            fontSize: '12px', fontWeight: 600, color: PALETTE.text,
            background: PALETTE.card, border: `1px solid ${PALETTE.border}`,
            borderRadius: '999px', padding: '6px 14px',
          }}
        >
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: tag.color, display: 'inline-block' }} />
          {tag.label}
        </span>
      ))}
    </div>
  )
}

function InfoBarItem({ emoji, label, value }: { emoji: string; label: string; value: string }) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '12px', padding: '18px 20px' }}>
      <span style={{ fontSize: '20px' }}>{emoji}</span>
      <div>
        <p style={{ margin: 0, fontSize: '11px', letterSpacing: '0.08em', color: PALETTE.muted }}>{label}</p>
        <p style={{ margin: '2px 0 0', fontSize: '14px', fontWeight: 700, color: PALETTE.text }}>{value}</p>
      </div>
    </div>
  )
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      style={{
        background: PALETTE.card, border: `1px solid ${PALETTE.border}`, borderRadius: '18px',
        padding: '18px 20px', boxShadow: PALETTE.shadow,
      }}
    >
      <p style={{ margin: '0 0 12px', fontSize: '11px', letterSpacing: '0.14em', color: PALETTE.gold, fontWeight: 700 }}>
        {title}
      </p>
      {children}
    </div>
  )
}
