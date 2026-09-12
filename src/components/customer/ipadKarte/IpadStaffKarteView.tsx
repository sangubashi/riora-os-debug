'use client'
/**
 * IpadStaffKarteView.tsx — iPad専用スタッフカルテ画面(PHASE IPAD-1・2026-09-11)。
 *
 * 旧CustomerBottomSheetを置き換えるものではなく、並行稼働の試験画面として追加する。
 * CustomerBottomSheet本体のstate/useEffectには一切触れず、customerId/customerNameのみを
 * 受け取る自己完結コンポーネント(CustomerModeViewと同じ設計方針)。
 *
 * 今回のスコープ(🟢項目のみ・READ ONLY調査2026-09-11で合意):
 *   左カラム: 重要事項・目標・カルテメモ(PHASE IPAD-3で追加)
 *   右カラム: 写真カルテ(正面/左45/右45、前回|今回比較)・肌の特徴タグ(簡易版)・
 *             今日の施術(自由記述、手順テンプレート化はしない)・次回の目安
 * 前回の施術・AI接客ポイント・次回提案は次フェーズ(🟡項目)のため、この画面にはまだ無い。
 *
 * カルテメモ(customer_karte_memos)はcustomer_memories/customer_notesとは独立した
 * 新規テーブル。AI(ProposalOrchestrator/FireScore/TodayFocusCard等)からは一切
 * 参照・書き込みしない(KarteMemoSection.tsx・src/types/customerKarteMemo.tsの絶対ルール)。
 *
 * 写真比較UIはCustomerModeViewと共有(src/components/customer/shared/PhotoCompareKit.tsx)。
 */
import { useState } from 'react'
import { Flower2, X, Pencil } from 'lucide-react'
import { useIpadKarteData, IPAD_KARTE_ANGLES, type IpadKarteAngleId, type RetailProductStatus } from './ipadKarteData'
import KarteMemoSection from './KarteMemoSection'
import GoalEditCard from './GoalEditCard'
import KarteImportSection from '@/components/customer/KarteImportSection'
import { PALETTE, headingFont, Card, PhotoPanel, SkinTagRow } from '@/components/customer/shared/PhotoCompareKit'
import { useNextVisit } from '@/lib/nextVisit/useNextVisit'
import { formatWeeksLabel, formatApproxDateLabel } from '@/lib/nextVisit/nextVisitEngine'

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']
/** クイック選択の候補(本日起点の週数)。 */
const QUICK_WEEK_OPTIONS = [2, 4, 6, 8]

function todayIsoUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

function addWeeksIso(weeks: number): string {
  const d = new Date()
  d.setDate(d.getDate() + weeks * 7)
  return d.toISOString().slice(0, 10)
}

/** "YYYY-MM-DD"同士の日数差(UTC基準)。顧客ステータスパネルの経過日数表示に使う。 */
function daysBetweenIso(fromStr: string, toStr: string): number {
  const from = new Date(`${fromStr}T00:00:00Z`).getTime()
  const to = new Date(`${toStr}T00:00:00Z`).getTime()
  return Math.round((to - from) / 86_400_000)
}

/** 対象日付を含む月のミニカレンダー(「カレンダー形式で視覚的に提示」の要件)。 */
function MiniCalendar({ dateStr }: { dateStr: string }) {
  const target = new Date(`${dateStr}T00:00:00`)
  const year = target.getFullYear()
  const month = target.getMonth()
  const day = target.getDate()
  const firstWeekday = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: Array<number | null> = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  return (
    <div>
      <p style={{ margin: '0 0 8px', fontSize: '12px', fontWeight: 700, color: PALETTE.text, textAlign: 'center' }}>
        {year}年{month + 1}月
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
        {WEEKDAYS.map(w => (
          <span key={w} style={{ fontSize: '10px', color: PALETTE.muted, textAlign: 'center' }}>{w}</span>
        ))}
        {cells.map((d, i) => (
          <span
            key={i}
            style={{
              textAlign: 'center', fontSize: '12px', padding: '6px 0', borderRadius: '8px',
              background: d === day ? PALETTE.gold : 'transparent',
              color: d === day ? '#FFFFFF' : d ? PALETTE.text : 'transparent',
              fontWeight: d === day ? 700 : 400,
            }}
          >
            {d ?? '·'}
          </span>
        ))}
      </div>
    </div>
  )
}

/** 数値のみの簡易表示行(顧客ステータスパネル用)。 */
function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '10px' }}>
      <span style={{ fontSize: '11px', color: PALETTE.muted }}>{label}</span>
      <span style={{ fontSize: '13px', fontWeight: 700, color: PALETTE.text, textAlign: 'right' }}>{value}</span>
    </div>
  )
}

/**
 * 顧客ステータスパネル(PHASE RETAIL-ITEMS-1・2026-09-12・購買・来店周期データ管理 Phase1)。
 * 最終来店日・来店周期・経過日数・次回来店目安(既存next-visitエンジンをそのまま使う。
 * 次回の目安の編集操作自体は下のNextVisitCardが担うため、ここでは事実の一覧表示のみ)と、
 * 店販商品ごとの最終購入日・累計購入額・購入周期(homecare-products APIの拡張分)を表示する。
 * すべて自動計算・スタッフ入力は一切不要(Phase1確定方針どおり)。
 */
function CustomerStatusPanel({
  customerId, lastVisitDate, visitCount, retailProducts,
}: {
  customerId: string
  lastVisitDate: string | null
  visitCount: number
  retailProducts: RetailProductStatus[]
}) {
  const nextVisit = useNextVisit(customerId)
  const today = todayIsoUtc()
  const daysSinceLastVisit = lastVisitDate ? daysBetweenIso(lastVisitDate, today) : null

  return (
    <Card title="📊 顧客ステータス">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <StatusRow label="最終来店日" value={lastVisitDate ? formatApproxDateLabel(lastVisitDate) : '来店履歴なし'} />
        <StatusRow label="来店回数" value={`${visitCount}回`} />
        <StatusRow
          label="来店周期の目安"
          value={nextVisit.result?.cycleDays != null ? `約${nextVisit.result.cycleDays}日ごと` : '算出データ不足'}
        />
        <StatusRow
          label="前回来店から経過"
          value={daysSinceLastVisit != null ? `${daysSinceLastVisit}日` : '—'}
        />
        <StatusRow
          label="次回来店目安"
          value={nextVisit.result?.estimatedDate ? formatApproxDateLabel(nextVisit.result.estimatedDate) : '算出データ不足'}
        />
      </div>

      {retailProducts.length > 0 && (
        <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: `1px solid ${PALETTE.border}` }}>
          <p style={{ margin: '0 0 10px', fontSize: '11px', letterSpacing: '0.08em', color: PALETTE.gold, fontFamily: headingFont.style.fontFamily }}>
            店販購入ステータス(商品ごと)
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {retailProducts.map(p => (
              <div key={p.productName} style={{ background: PALETTE.bg, borderRadius: '12px', padding: '10px 12px' }}>
                <p style={{ margin: '0 0 4px', fontSize: '13px', fontWeight: 700, color: PALETTE.text }}>{p.productName}</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <StatusRow label="最終購入日" value={formatApproxDateLabel(p.lastPurchasedAt)} />
                  <StatusRow
                    label="累計購入額"
                    value={p.totalAmount != null ? `¥${p.totalAmount.toLocaleString('ja-JP')}` : '集計データなし'}
                  />
                  <StatusRow
                    label="購入周期"
                    value={p.averageIntervalDays != null ? `約${p.averageIntervalDays}日ごと` : '算出データ不足(購入1回のみ)'}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

/**
 * 次回の目安カード。次回目安エンジン(useNextVisit)の結果表示と、担当スタッフによる
 * 手動上書きの入力を担う。「次回提案(施術メニューの提案・StaffProposalSection)」とは
 * 完全に別物であり、このカードでは一切扱わない。
 */
function NextVisitCard({ customerId }: { customerId: string }) {
  const { loading, result, overrideDate, saving, setOverride } = useNextVisit(customerId)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  if (loading) {
    return (
      <Card title="📅 次回の目安">
        <p style={{ margin: 0, fontSize: '12px', color: PALETTE.muted }}>読み込み中…</p>
      </Card>
    )
  }
  if (!result || !result.estimatedDate) {
    return (
      <Card title="📅 次回の目安">
        <p style={{ margin: 0, fontSize: '12px', color: PALETTE.muted }}>{result?.basisLabel ?? 'データがありません'}</p>
      </Card>
    )
  }

  const daysFromToday = Math.round(
    (new Date(`${result.estimatedDate}T00:00:00`).getTime() - new Date(`${todayIsoUtc()}T00:00:00`).getTime()) / 86_400_000
  )

  const startEditing = () => {
    setDraft(overrideDate ?? result.estimatedDate ?? todayIsoUtc())
    setEditing(true)
  }

  return (
    <Card title="📅 次回の目安">
      {!editing ? (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
            <div>
              <p style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: PALETTE.text }}>
                {formatWeeksLabel(daysFromToday)}（{formatApproxDateLabel(result.estimatedDate)}）
              </p>
              <p style={{ margin: '6px 0 0', fontSize: '11px', color: PALETTE.muted, lineHeight: 1.6 }}>
                {result.basisLabel}
              </p>
            </div>
            <button
              type="button"
              onClick={startEditing}
              aria-label="次回の目安を手動で設定する"
              style={{
                flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px',
                fontSize: '11px', fontWeight: 600, color: PALETTE.gold,
                background: PALETTE.bg, border: `1px solid ${PALETTE.border}`,
                borderRadius: '999px', padding: '6px 12px', cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              <Pencil size={12} strokeWidth={2} />
              手動で設定
            </button>
          </div>
          <div style={{ marginTop: '14px' }}>
            <MiniCalendar dateStr={result.estimatedDate} />
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {QUICK_WEEK_OPTIONS.map(w => (
              <button
                key={w}
                type="button"
                onClick={() => setDraft(addWeeksIso(w))}
                style={{
                  fontSize: '11px', fontWeight: 600, color: PALETTE.text,
                  background: draft === addWeeksIso(w) ? PALETTE.gold : PALETTE.bg,
                  border: `1px solid ${PALETTE.border}`, borderRadius: '999px', padding: '6px 12px', cursor: 'pointer',
                }}
              >
                {w}週間後
              </button>
            ))}
          </div>
          <input
            type="date"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            style={{
              padding: '8px 10px', borderRadius: '10px', border: `1px solid ${PALETTE.border}`,
              fontSize: '13px', color: PALETTE.text,
            }}
          />
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              disabled={saving || !draft}
              onClick={async () => { const ok = await setOverride(draft); if (ok) setEditing(false) }}
              style={{
                flex: 1, padding: '10px', borderRadius: '999px', border: 'none', cursor: 'pointer',
                background: PALETTE.gold, color: '#FFFFFF', fontSize: '12px', fontWeight: 700,
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? '保存中…' : 'この日付で設定'}
            </button>
            {overrideDate && (
              <button
                type="button"
                disabled={saving}
                onClick={async () => { const ok = await setOverride(null); if (ok) setEditing(false) }}
                style={{
                  padding: '10px 14px', borderRadius: '999px', cursor: 'pointer',
                  background: 'transparent', border: `1px solid ${PALETTE.border}`, color: PALETTE.muted, fontSize: '12px',
                }}
              >
                自動算出に戻す
              </button>
            )}
            <button
              type="button"
              onClick={() => setEditing(false)}
              style={{
                padding: '10px 14px', borderRadius: '999px', cursor: 'pointer',
                background: 'transparent', border: 'none', color: PALETTE.muted, fontSize: '12px',
              }}
            >
              キャンセル
            </button>
          </div>
        </div>
      )}
    </Card>
  )
}

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

              {/* 目標編集(PHASE IPAD-6・2026-09-12・READ ONLY調査に基づき追加)。
                  goal_noteの編集UI(GoalSection.tsx)がCustomerBottomSheet.tsxにしか無く
                  196人中0人と定着していなかったため、iPadスタッフカルテ側にも編集導線を
                  追加する。保存先・API(GET/PATCH /api/customers/[id]/goal)は無変更、
                  CustomerBottomSheet.tsxにも一切触れない。常時表示(お客様の目標カードと
                  同じ方針)。保存後はcontraindications/goalNoteのみ軽量再取得する。 */}
              <GoalEditCard
                customerId={customerId}
                goalNote={data.goalNote}
                onSaved={() => { void data.refetchGoalAndContraindications() }}
              />

              <KarteMemoSection customerId={customerId} />

              {/* Salon Boardカルテ取込(PHASE IPAD-5・2026-09-12・導線改善調査に基づき追加)。
                  KarteImportSection自体は無変更で移植(customerId/customerName/onSavedのみに
                  依存する自己完結コンポーネント)。保存後はcontraindications/goalNoteのみ
                  軽量再取得する(data.refetchGoalAndContraindications、写真等は再取得しない)。 */}
              <KarteImportSection
                customerId={customerId}
                customerName={customerName}
                onSaved={() => { void data.refetchGoalAndContraindications() }}
              />
            </div>

            {/* ── 右カラム ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* 顧客ステータス(購買・来店周期データ管理 Phase1・2026-09-12)。すべて自動計算・
                  スタッフ入力不要。次回目安の編集操作自体は下のNextVisitCardが担う。 */}
              <CustomerStatusPanel
                customerId={customerId}
                lastVisitDate={data.lastVisitDate}
                visitCount={data.visitCount}
                retailProducts={data.retailProducts}
              />

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

              {/* 今回のホームケア(PHASE IPAD-4・2026-09-12・READ ONLY調査に基づき追加)。
                  CustomerModeView.tsxの同カードと同じ表示構造・データ取得ロジック(ipadKarteData.ts)。
                  LINE下書き生成への接続は今回のスコープ外(表示のみ)。 */}
              {data.homecareItems.length > 0 && (
                <Card title="🏠 今回のホームケア">
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
                        {item.caution && (
                          <div>
                            <p style={{ margin: 0, fontSize: '11px', letterSpacing: '0.06em', color: PALETTE.muted }}>
                              使用上の注意
                            </p>
                            <p style={{ margin: '2px 0 0', fontSize: '12px', color: PALETTE.text, lineHeight: 1.6 }}>
                              {item.caution}
                            </p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* 次回の目安(次回目安エンジン)。次回提案(施術メニューの提案)とは別項目 — 混同しない。 */}
              <NextVisitCard customerId={customerId} />
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
