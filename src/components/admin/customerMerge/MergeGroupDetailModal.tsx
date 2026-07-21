'use client'
/**
 * MergeGroupDetailModal.tsx — 顧客統合 Phase2(グループ詳細比較)+ Phase3(統合実行)UI
 *
 * 設計根拠: docs/DUPLICATE_MERGE_QUEUE_DESIGN.md §3(画面B・C相当)・
 * docs/DUPLICATE_MERGE_QUEUE_IMPLEMENTATION_REVIEW.md §4(UIレビュー指摘の反映)
 *
 * 統合先(生き残り)はシステムが推奨マークを付けるが、最終選択は管理者が行う
 * (CUSTOMER_DUPLICATE_MANAGEMENT_V1.md §4.2「システムが自動選択しない」方針を維持)。
 *
 * IMPLEMENTATION_REVIEW.md §4指摘の反映点:
 *   1. 区分C(統合禁止)は統合先選択自体をブロックする(ラベル表示だけでなく実効的に)
 *   2. 統合完了後、モーダルを閉じずに完了画面(opsLogId表示+rollback導線)を表示する
 *   3. opsLogIdをコピー可能な形で表示する
 *   4. 実行中(isExecuting)・rollback中(isRollingBack)は背景クリック・×ボタンでの
 *      クローズを無効化する
 *   5. 最終確認ステップに統合先/削除対象の氏名・件数を明示する
 */
import { useState } from 'react'
import { X, AlertTriangle, Star, Loader2, ShieldAlert, Ban, Copy, Check, Undo2 } from 'lucide-react'
import { useCustomerMergeStore } from '@/store/useCustomerMergeStore'
import { DEMO_STORE_ID } from '@/lib/constants'

function formatYen(n: number): string {
  return `¥${n.toLocaleString('ja-JP')}`
}

const TH_STYLE: React.CSSProperties = {
  textAlign: 'left', fontSize: '11px', color: '#9F7E6C', fontWeight: 700,
  padding: '8px 10px', whiteSpace: 'nowrap', borderBottom: '1px solid #F5EEF0',
}
const TD_STYLE: React.CSSProperties = {
  fontSize: '12px', color: '#5C4033', padding: '8px 10px', whiteSpace: 'nowrap',
  borderBottom: '1px solid #FAF3F4',
}

export default function MergeGroupDetailModal({ onClose }: { onClose: () => void }) {
  const {
    selectedDetail, isDetailLoading, detailError,
    executeMerge, isExecuting, executeError, lastExecuteResult,
    rollbackMerge, isRollingBack, rollbackError,
  } = useCustomerMergeStore()
  const [selectedSurvivorId, setSelectedSurvivorId] = useState<string | null>(null)
  const [confirmStep, setConfirmStep] = useState(false)
  const [copied, setCopied] = useState(false)
  const [rolledBack, setRolledBack] = useState(false)

  const survivorId = selectedSurvivorId ?? selectedDetail?.recommendedSurvivorId ?? null
  const isCategoryC = selectedDetail?.category === 'C'
  // 実行中・rollback中は誤操作防止のためモーダルを閉じさせない(REVIEW.md §4-4)
  const closeLocked = isExecuting || isRollingBack

  const hasContraindication = (customerId: string) =>
    selectedDetail?.contraindications.some((c) => c.customerId === customerId) ?? false

  function handleBackdropClose() {
    if (closeLocked) return
    onClose()
  }

  async function handleExecute() {
    if (!selectedDetail || !survivorId || isCategoryC) return
    const mergedIds = selectedDetail.members.filter((m) => m.customerId !== survivorId).map((m) => m.customerId)
    await executeMerge({
      storeId: DEMO_STORE_ID,
      mergeGroupId: selectedDetail.groupKey,
      survivorId,
      mergedIds,
    })
    // 完了画面(opsLogId + rollback導線)へ遷移するため、ここではモーダルを閉じない。
  }

  async function handleRollback() {
    if (!lastExecuteResult) return
    const ok = await rollbackMerge({ storeId: DEMO_STORE_ID, opsLogId: lastExecuteResult.opsLogId })
    if (ok) setRolledBack(true)
  }

  async function handleCopyOpsLogId() {
    if (!lastExecuteResult) return
    try {
      await navigator.clipboard.writeText(lastExecuteResult.opsLogId)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // クリップボード権限が無い環境向けのフォールバックは不要(手動選択でコピー可能なテキストとして表示済み)
    }
  }

  const survivorMember = selectedDetail?.members.find((m) => m.customerId === survivorId) ?? null
  const mergedMembers = selectedDetail?.members.filter((m) => m.customerId !== survivorId) ?? []

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(92,64,51,0.35)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
      onClick={handleBackdropClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: '18px', maxWidth: '860px', width: '100%', maxHeight: '86vh', overflowY: 'auto', padding: '20px' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#5C4033' }}>統合候補グループ詳細</h2>
          <button
            onClick={handleBackdropClose}
            disabled={closeLocked}
            style={{ background: 'none', border: 'none', cursor: closeLocked ? 'default' : 'pointer', color: closeLocked ? '#E8DCE0' : '#9F7E6C' }}
          >
            <X size={20} />
          </button>
        </div>

        {isDetailLoading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 0', color: '#C8A8B0' }}>
            <Loader2 size={18} className="animate-spin" style={{ marginRight: '8px' }} />
            読み込み中...
          </div>
        )}

        {detailError && (
          <div style={{ padding: '16px', color: '#D14F4F', fontSize: '13px' }}>詳細の取得に失敗しました: {detailError}</div>
        )}

        {selectedDetail && !isDetailLoading && (
          <>
            {/* 統合完了後: opsLogId表示 + rollback導線(REVIEW.md §4-2/§4-3) */}
            {lastExecuteResult ? (
              <div style={{ padding: '14px', background: rolledBack ? '#F1F7F2' : '#EFF7F1', border: `1px solid ${rolledBack ? '#CFE3D2' : '#CDE8D4'}`, borderRadius: '12px', marginBottom: '14px' }}>
                <p style={{ fontSize: '13px', fontWeight: 700, color: '#2E7D46', marginBottom: '6px' }}>
                  {rolledBack ? '統合を取り消しました(rollback完了)' : '統合が完了しました'}
                </p>
                <p style={{ fontSize: '11px', color: '#5C4033', marginBottom: '8px' }}>
                  移動したvisit数: {lastExecuteResult.visitsReassigned}件
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
                  <span style={{ fontSize: '10px', color: '#9F7E6C' }}>opsLogId:</span>
                  <code style={{ fontSize: '11px', background: '#fff', border: '1px solid #DDE8DE', borderRadius: '6px', padding: '3px 8px', userSelect: 'all' }}>
                    {lastExecuteResult.opsLogId}
                  </code>
                  <button
                    onClick={handleCopyOpsLogId}
                    style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '10px', color: '#2E7D46', background: 'none', border: 'none', cursor: 'pointer' }}
                  >
                    {copied ? <Check size={12} /> : <Copy size={12} />}
                    {copied ? 'コピーしました' : 'コピー'}
                  </button>
                </div>

                {rollbackError && <p style={{ fontSize: '11px', color: '#D14F4F', marginBottom: '8px' }}>rollbackに失敗しました: {rollbackError}</p>}

                {!rolledBack && (
                  <button
                    disabled={isRollingBack}
                    onClick={handleRollback}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: 700,
                      color: '#8A6D2F', background: '#FDF0DA', border: 'none', borderRadius: '8px',
                      padding: '7px 12px', cursor: isRollingBack ? 'default' : 'pointer',
                    }}
                  >
                    {isRollingBack ? <Loader2 size={12} className="animate-spin" /> : <Undo2 size={12} />}
                    この統合を元に戻す(rollback)
                  </button>
                )}
              </div>
            ) : (
              <>
                <p style={{ fontSize: '12px', color: '#9F7E6C', marginBottom: '10px' }}>
                  区分: {selectedDetail.category === 'A' ? '安全に自動統合可能' : selectedDetail.category === 'B' ? '要確認' : '統合禁止'}
                  {!isCategoryC && '・統合先(生き残り)を選択してください(★は推奨)'}
                </p>

                {isCategoryC && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 12px', background: '#FBE4E4', border: '1px solid #F0C6C6', borderRadius: '10px', marginBottom: '10px' }}>
                    <Ban size={14} style={{ color: '#C43D3D', flexShrink: 0 }} />
                    <p style={{ fontSize: '12px', color: '#8A3D3D' }}>
                      このグループは区分C(統合禁止)のため統合できません。別人の可能性がある根拠が検出されています。
                    </p>
                  </div>
                )}
              </>
            )}

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {!lastExecuteResult && !isCategoryC && <th style={TH_STYLE}>選択</th>}
                    <th style={TH_STYLE}>氏名</th>
                    <th style={TH_STYLE}>顧客ID</th>
                    <th style={TH_STYLE}>visit数</th>
                    <th style={TH_STYLE}>売上(LTV)</th>
                    <th style={TH_STYLE}>初回来店</th>
                    <th style={TH_STYLE}>最終来店</th>
                    <th style={TH_STYLE}>担当</th>
                    <th style={TH_STYLE}>作成日</th>
                    <th style={TH_STYLE}>禁忌</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedDetail.members.map((m) => {
                    const isSurvivor = m.customerId === survivorId
                    const contraFlag = hasContraindication(m.customerId)
                    return (
                      <tr key={m.customerId} style={contraFlag ? { background: '#FFF4F4' } : undefined}>
                        {!lastExecuteResult && !isCategoryC && (
                          <td style={TD_STYLE}>
                            <input
                              type="radio"
                              name="survivor"
                              checked={isSurvivor}
                              onChange={() => setSelectedSurvivorId(m.customerId)}
                            />
                          </td>
                        )}
                        <td style={TD_STYLE}>
                          {m.name}
                          {m.recommendedSurvivor && <Star size={11} style={{ marginLeft: '4px', color: '#D9A23C', display: 'inline' }} />}
                        </td>
                        <td style={{ ...TD_STYLE, fontFamily: 'monospace', fontSize: '10px', color: '#9F7E6C' }}>{m.customerId.slice(0, 8)}</td>
                        <td style={TD_STYLE}>{m.visitCount}</td>
                        <td style={TD_STYLE}>{formatYen(m.totalSales)}</td>
                        <td style={TD_STYLE}>{m.firstVisitDate ?? '—'}</td>
                        <td style={TD_STYLE}>{m.lastVisitDate ?? '—'}</td>
                        <td style={TD_STYLE}>{m.assignedStaffNames.join('・') || '—'}</td>
                        <td style={TD_STYLE}>{m.createdAt.slice(0, 10)}</td>
                        <td style={TD_STYLE}>
                          {contraFlag && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: '3px', color: '#D14F4F', fontWeight: 700 }}>
                              <AlertTriangle size={12} /> あり
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {selectedDetail.contraindications.length > 0 && (
              <div style={{ marginTop: '12px', padding: '10px 12px', background: '#FFF4F4', border: '1px solid #F5C6C6', borderRadius: '10px' }}>
                <p style={{ fontSize: '12px', fontWeight: 700, color: '#D14F4F', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
                  <ShieldAlert size={13} /> 禁忌情報(統合前に必ず確認してください)
                </p>
                {selectedDetail.contraindications.map((c, i) => (
                  <p key={i} style={{ fontSize: '11px', color: '#8A4A4A' }}>
                    [{c.severity}] {c.title}{c.description ? ` — ${c.description}` : ''}
                  </p>
                ))}
              </div>
            )}

            {!lastExecuteResult && !isCategoryC && (
              <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {!confirmStep ? (
                  <button
                    disabled={!survivorId}
                    onClick={() => setConfirmStep(true)}
                    style={{
                      alignSelf: 'flex-start', fontSize: '13px', fontWeight: 700, color: '#fff',
                      background: survivorId ? '#D98292' : '#E8C0C8', border: 'none', borderRadius: '10px',
                      padding: '9px 16px', cursor: survivorId ? 'pointer' : 'default',
                    }}
                  >
                    統合先を選ぶ
                  </button>
                ) : (
                  <div style={{ padding: '12px', background: '#FFF8F7', border: '1px solid #F0E0E4', borderRadius: '10px' }}>
                    <p style={{ fontSize: '12px', fontWeight: 700, color: '#5C4033', marginBottom: '6px' }}>
                      統合先: {survivorMember?.name ?? '—'}様({survivorMember?.customerId.slice(0, 8)}...)
                      <br />
                      削除対象: {mergedMembers.map((m) => m.name).join('・') || '—'}様({mergedMembers.length}件)
                    </p>
                    <p style={{ fontSize: '12px', color: '#8A6D2F', marginBottom: '8px' }}>
                      この操作は取り消しが難しくなる場合があります(統合後に新しい来店データが追加されると完全なrollbackができなくなります)。
                      本当に統合を実行しますか?
                    </p>
                    {executeError && <p style={{ fontSize: '11px', color: '#D14F4F', marginBottom: '8px' }}>実行に失敗しました: {executeError}</p>}
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        disabled={isExecuting}
                        onClick={handleExecute}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: 700,
                          color: '#fff', background: '#D14F4F', border: 'none', borderRadius: '8px',
                          padding: '8px 14px', cursor: isExecuting ? 'default' : 'pointer',
                        }}
                      >
                        {isExecuting && <Loader2 size={12} className="animate-spin" />}
                        統合を実行する
                      </button>
                      <button
                        disabled={isExecuting}
                        onClick={() => setConfirmStep(false)}
                        style={{ fontSize: '12px', color: '#9F7E6C', background: 'none', border: 'none', cursor: 'pointer' }}
                      >
                        キャンセル
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {lastExecuteResult && (
              <div style={{ marginTop: '16px' }}>
                <button
                  onClick={onClose}
                  style={{ fontSize: '12px', fontWeight: 700, color: '#5C4033', background: '#F5EEF0', border: 'none', borderRadius: '8px', padding: '8px 14px', cursor: 'pointer' }}
                >
                  閉じる
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
