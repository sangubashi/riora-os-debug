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
import { useState } from 'react'
import { Playfair_Display } from 'next/font/google'
import { X, Leaf, CalendarDays, Flower2 } from 'lucide-react'
import {
  useCustomerModeData,
  CUSTOMER_MODE_ANGLES,
  type CustomerModeAngleId,
} from './customerModeData'
import {
  PALETTE,
  headingFont,
  Card,
  PhotoPanel,
  SkinTagRow,
  InfoBarItem,
  formatVisitDateLabel,
} from '@/components/customer/shared/PhotoCompareKit'
import { useNextVisit } from '@/lib/nextVisit/useNextVisit'
import { formatWeeksLabel, type NextVisitResult } from '@/lib/nextVisit/nextVisitEngine'

// ロゴ用: エレガントな欧文セリフ体(イタリック)。高級サロンのブランドロゴらしい質感のため
// システム標準フォントのitalic指定をやめ、専用フォントを読み込む(PHASE GUEST-MODE-1-DESIGN)。
const logoFont = Playfair_Display({ subsets: ['latin'], weight: '600', style: 'italic', display: 'swap' })

interface Props {
  customerId: string
  customerName: string
  onClose: () => void
}

export default function CustomerModeView({ customerId, customerName, onClose }: Props) {
  const data = useCustomerModeData(customerId)
  const [angle, setAngle] = useState<CustomerModeAngleId>('face_front')
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  /**
   * 「過去の写真・来店履歴」でタップされた来店回のid(PHASE GUEST-MODE-2)。
   * 現時点では選択状態を保持するのみで、実際の比較表示切り替えは別Phaseで実装する
   * (タップ→選択の導線とデータ取得までが今回のスコープ)。
   */
  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null)

  // 次回目安エンジン(PHASE NEXT-VISIT-1・2026-09-11)。お客様モードでは具体的な日付は出さず、
  // 「約◯週間後」のみ表示する(次回予約が既にある場合のみ日付を表示)。
  const nextVisit = useNextVisit(customerId)

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
          background: PALETTE.bg,
          borderBottom: `1px solid ${PALETTE.border}`,
        }}
      >
        <div>
          <p
            style={{
              margin: 0, display: 'flex', alignItems: 'center', gap: '6px',
              fontSize: '20px', color: PALETTE.gold, letterSpacing: '0.01em',
              fontFamily: logoFont.style.fontFamily,
            }}
          >
            <Flower2 size={16} strokeWidth={1.4} color={PALETTE.gold} />
            Salon Riora
          </p>
          <p
            style={{
              margin: '4px 0 0', fontSize: '9px', letterSpacing: '0.2em', color: PALETTE.muted,
              textTransform: 'uppercase',
            }}
          >
            Japanese High-End Aesthetic Salon
          </p>
        </div>
        <p
          style={{
            margin: 0, fontSize: '18px', color: PALETTE.text, letterSpacing: '0.04em',
            whiteSpace: 'nowrap', fontFamily: headingFont.style.fontFamily,
          }}
        >
          お肌の変化を一緒に確認しましょう
        </p>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '14px' }}>
          <p style={{ margin: 0, fontSize: '11px', letterSpacing: '0.06em', color: PALETTE.muted, whiteSpace: 'nowrap' }}>
            {customerName}様
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="お客様モードを終了"
            style={{
              width: '52px', height: '52px', borderRadius: '50%', flexShrink: 0,
              background: PALETTE.card, border: `1.5px solid ${PALETTE.gold}`, color: PALETTE.text,
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            }}
          >
            <X size={22} strokeWidth={2.2} />
          </button>
        </div>
      </div>

      {/* ── スクロール領域(「1画面目」+「スクロール部分」を1つの連続スクロールにまとめる) ── */}
      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <div style={{ maxWidth: '1140px', margin: '0 auto', padding: '24px 24px 48px' }}>

          {/* 角度タブ */}
          <div style={{ display: 'flex', gap: '32px', borderBottom: `1px solid ${PALETTE.border}`, marginBottom: '20px' }}>
            {CUSTOMER_MODE_ANGLES.map(a => (
              <button
                key={a.id}
                type="button"
                onClick={() => setAngle(a.id)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: '0 0 12px', fontSize: '15px', letterSpacing: '0.06em',
                  color: angle === a.id ? PALETTE.text : PALETTE.muted,
                  borderBottom: angle === a.id ? `2px solid ${PALETTE.gold}` : '2px solid transparent',
                  fontFamily: headingFont.style.fontFamily,
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
                  visitDate={pair?.reference?.visitDate ?? pair?.reference?.takenAt ?? null}
                  emptyText="前回の写真はまだありません"
                  onExpand={referenceUrl ? () => setLightboxUrl(referenceUrl) : undefined}
                />
                <PhotoPanel
                  label="今回"
                  url={currentUrl}
                  visitCountAt={pair?.current?.visitCountAt ?? null}
                  visitDate={pair?.current?.visitDate ?? pair?.current?.takenAt ?? null}
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
                <InfoBarItem icon={Leaf} label="今回の施術" value={data.currentMenuName ?? '本日のメニューは準備中です'} />
                <div style={{ width: '1px', background: PALETTE.border }} />
                <NextVisitInfoCell result={nextVisit.result} />
              </div>
            </>
          )}

          {/* ── スクロール部分 ── */}
          {!data.loading && (
            <div style={{ marginTop: '36px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {data.homecareItems.length > 0 && (
                <Card title="今回のホームケア">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                    {data.homecareItems.map(item => (
                      <div key={item.productName} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div>
                          <p style={{ margin: 0, fontSize: '11px', letterSpacing: '0.06em', color: PALETTE.muted }}>
                            商品名
                          </p>
                          <p style={{ margin: '2px 0 0', fontSize: '14px', fontWeight: 700, color: PALETTE.text }}>
                            {item.productName}
                          </p>
                        </div>
                        {/* 2026-09-11: frequency/timingのラベルが入れ替わっていた表示バグを修正
                            (frequency=使用頻度・timing=使用タイミング。値自体は無変更)。 */}
                        {item.frequency && (
                          <div>
                            <p style={{ margin: 0, fontSize: '11px', letterSpacing: '0.06em', color: PALETTE.muted }}>
                              使用頻度
                            </p>
                            <p style={{ margin: '2px 0 0', fontSize: '12px', color: PALETTE.text, lineHeight: 1.6 }}>
                              {item.frequency}
                            </p>
                          </div>
                        )}
                        {item.timing && (
                          <div>
                            <p style={{ margin: 0, fontSize: '11px', letterSpacing: '0.06em', color: PALETTE.muted }}>
                              使用タイミング
                            </p>
                            <p style={{ margin: '2px 0 0', fontSize: '12px', color: PALETTE.text, lineHeight: 1.6 }}>
                              {item.timing}
                            </p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {!!data.goalNote?.trim() && (
                <Card title="お客様の目標">
                  <p style={{ margin: 0, fontSize: '14px', color: PALETTE.text, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
                    {customerName}様の目標：{data.goalNote}
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

              {/* 過去の写真・来店履歴 — 将来のPhase B(比較表示切り替え)への入り口(PHASE GUEST-MODE-2)。
                  今回はタップ→選択の導線のみ。実際に比較対象を切り替える処理は別Phaseで実装する。 */}
              {data.visits.length > 0 && (
                <Card title="過去の写真・来店履歴">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {data.visits.map((visit, i) => {
                      const visitNumber = data.visits.length - i
                      const dateLabel = formatVisitDateLabel(visit.visitDate)
                      const selected = selectedVisitId === visit.id
                      return (
                        <button
                          key={visit.id}
                          type="button"
                          onClick={() => setSelectedVisitId(selected ? null : visit.id)}
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            width: '100%', textAlign: 'left', cursor: 'pointer',
                            padding: '12px 14px', borderRadius: '12px',
                            background: selected ? PALETTE.bg : 'transparent',
                            border: `1px solid ${selected ? PALETTE.gold : PALETTE.border}`,
                          }}
                        >
                          <span style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
                            <span style={{ fontSize: '13px', fontWeight: 700, color: PALETTE.text }}>
                              来店{visitNumber}回目
                            </span>
                            <span style={{ fontSize: '12px', color: PALETTE.muted }}>
                              {[dateLabel, visit.menuName].filter(Boolean).join(' ・ ')}
                            </span>
                          </span>
                          <span
                            style={{
                              fontSize: '11px', fontWeight: 600, color: selected ? PALETTE.gold : PALETTE.muted,
                              flexShrink: 0, marginLeft: '12px',
                            }}
                          >
                            {selected ? '選択中' : '比較に選ぶ'}
                          </span>
                        </button>
                      )
                    })}
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

/**
 * 「次回の目安」セル(PHASE NEXT-VISIT-1・2026-09-11)。次回目安エンジンの結果を
 * お客様向けに表示する。次回予約が既にある場合のみ具体的な日付(◯月◯日)を表示し、
 * それ以外は「約◯週間後」のみ(具体的な日付は出さない)。手動上書きは次回予約と
 * 同列には扱わない(あくまで目安のため、週数表示のまま)。
 */
function NextVisitInfoCell({ result }: { result: NextVisitResult | null }) {
  if (!result || !result.estimatedDate) {
    return <InfoBarItem icon={CalendarDays} label="次回の目安" value="ご来店後にご案内します" />
  }

  if (result.source === 'next_reservation') {
    return (
      <InfoBarItem
        icon={CalendarDays}
        label="次回のご予約"
        value={formatVisitDateLabel(result.estimatedDate) ?? 'ご来店後にご案内します'}
      />
    )
  }

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const target = new Date(`${result.estimatedDate}T00:00:00`)
  const daysFromToday = Math.round((target.getTime() - today.getTime()) / 86_400_000)

  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '14px', padding: '18px 20px' }}>
      <span
        style={{
          width: '34px', height: '34px', borderRadius: '50%', flexShrink: 0,
          background: PALETTE.bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <CalendarDays size={16} strokeWidth={1.4} color={PALETTE.gold} />
      </span>
      <div>
        <p style={{ margin: 0, fontSize: '11px', letterSpacing: '0.1em', color: PALETTE.muted }}>次回のお手入れ目安</p>
        <p style={{ margin: '2px 0 0', fontSize: '14px', fontWeight: 700, color: PALETTE.text }}>
          {formatWeeksLabel(daysFromToday)}
        </p>
        <p style={{ margin: '2px 0 0', fontSize: '9px', color: PALETTE.muted, lineHeight: 1.4 }}>
          お肌の状態を見ながら、次回のお手入れ時期をご案内しています。
        </p>
      </div>
    </div>
  )
}

// formatVisitDateLabel / PhotoPanel / SkinTagRow / InfoBarItem / Card は
// 2026-09-11、iPad専用スタッフカルテ画面(IpadStaffKarteView)との共有のため
// src/components/customer/shared/PhotoCompareKit.tsx へ移動した(ロジック・見た目は無変更)。
