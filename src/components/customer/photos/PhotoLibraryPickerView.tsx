'use client'
/**
 * PhotoLibraryPickerView.tsx — 写真カルテ Phase2「写真ライブラリから複数選択して登録」確認画面
 *
 * 設計根拠: Photo Karte Phase2 READ ONLY調査で確定した方針。
 *   - 呼び出し元(CustomerBottomSheet.tsx)が <input type="file" accept="image/*" multiple> で
 *     選択済みのFile[]を渡す。この画面自体はファイル選択UIを持たない
 *     (iOS Safariのファイル選択ダイアログはユーザー操作と同期したクリックでのみ確実に開くため、
 *     <input>要素とその.click()呼び出しは呼び出し元に置く)。
 *   - 選択直後はまだサーバーへ何もアップロードしない(ローカルで仮分類・確認・修正のみ)。
 *   - 一括登録を押すまでDB/Storageには一切書き込まれない。
 *   - 既存のカメラ撮影フロー(PhotoCaptureView.tsx・usePhotoCapture.ts・captureConfirmFlow.ts)
 *     には一切依存せず、完全に独立した画面として実装する。
 */
import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import { BODY_PART_OPTIONS, bodyPartLabel } from '@/lib/photos/bodyParts'
import {
  buildBatchItems,
  revokeBatchItemPreviews,
  summarizeUploadResults,
  uploadBatch,
  type BatchPhotoItem,
} from '@/lib/photos/batchUpload'

interface Props {
  customerId: string
  /** 単発撮影と同じく、本日分のvisitがあればそのID・無ければnull(単発登録扱い)。 */
  visitId:    string | null
  /** 呼び出し元の<input type="file" multiple>で選択済みのファイル一覧。 */
  files:      File[]
  onClose:    () => void
}

type Phase = 'review' | 'uploading' | 'done'

/** 大量選択時の目安(ハード制限ではない・警告表示のみ)。 */
const RECOMMENDED_MAX_FILES = 10

export default function PhotoLibraryPickerView({ customerId, visitId, files, onClose }: Props) {
  const [items, setItems] = useState<BatchPhotoItem[]>(() => buildBatchItems(files))
  const [phase, setPhase] = useState<Phase>('review')

  // アンマウント時に必ずobject URLを解放する(filesが変わることは無い前提だが、
  // Reactの厳密な二重実行(StrictMode)でも問題ないよう、items自体を直接cleanupで見る)。
  useEffect(() => {
    return () => { revokeBatchItemPreviews(items) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const successCount = useMemo(() => items.filter(i => i.status === 'success').length, [items])
  const errorCount   = useMemo(() => items.filter(i => i.status === 'error').length, [items])
  const totalCount   = items.length
  const hasFailures  = phase === 'done' && errorCount > 0

  const usedThreeShotRule = files.length === 3

  const updateBodyPart = (id: string, bodyPart: string) => {
    setItems(prev => prev.map(it => (it.id === id ? { ...it, bodyPart, isProvisional: false } : it)))
  }

  const removeItem = (id: string) => {
    setItems(prev => {
      const target = prev.find(it => it.id === id)
      if (target) revokeBatchItemPreviews([target])
      return prev.filter(it => it.id !== id)
    })
  }

  const handleCancel = () => {
    revokeBatchItemPreviews(items)
    onClose()
  }

  // 「選択して追加」経路で失敗しても画面が変化せず気づけない問題への対応
  // (無言失敗を禁止する)。uploadBatch自体は現状Promise.allSettledで例外を投げない設計だが、
  // 予期しない例外(将来の変更・環境依存の不具合等)でphaseが'uploading'のまま固まって
  // 何も表示されない事態を避けるため、必ずtry/catchで受け止めてtoast表示までたどり着かせる。
  const runUpload = async (targets: BatchPhotoItem[]) => {
    if (targets.length === 0) return
    const targetIds = new Set(targets.map(t => t.id))
    setPhase('uploading')
    setItems(prev => prev.map(it => (targetIds.has(it.id) ? { ...it, status: 'uploading', error: undefined } : it)))

    try {
      const results = await uploadBatch(customerId, visitId, targets)
      const resultById = new Map(results.map(r => [r.itemId, r]))

      setItems(prev =>
        prev.map(it => {
          const r = resultById.get(it.id)
          if (!r) return it
          return r.ok ? { ...it, status: 'success' } : { ...it, status: 'error', error: r.error }
        })
      )
      setPhase('done')

      const summary = summarizeUploadResults(results)
      if (summary.isError) {
        toast.error(summary.message)
      } else {
        toast.success(summary.message)
      }
    } catch (e) {
      // uploadBatch自体が予期せず例外を投げた場合でも、対象アイテムをエラー状態にして
      // 必ずtoastで知らせる(「押したのに何も起きない」状態を残さない)。
      const message = e instanceof Error ? e.message : 'upload_failed'
      setItems(prev =>
        prev.map(it => (targetIds.has(it.id) ? { ...it, status: 'error', error: message } : it))
      )
      setPhase('done')
      toast.error('登録に失敗しました。もう一度お試しください')
    }
  }

  const handleRegister = () => { void runUpload(items) }
  const handleRetryFailed = () => { void runUpload(items.filter(it => it.status === 'error')) }

  const isBusy = phase === 'uploading'

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(30, 30, 40, 0.5)',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 'var(--app-max-width, 430px)',
          height: '100%',
          margin: '0 auto',
          background: '#FAFCFF',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* ── ヘッダー ── */}
        <div style={{
          flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: 'max(20px, calc(env(safe-area-inset-top) + 12px)) 16px 12px',
          borderBottom: '1px solid #E4EEF8', background: '#fff',
        }}>
          <div>
            <p style={{ fontSize: '11px', letterSpacing: '0.18em', color: '#4878A8', fontWeight: 600 }}>
              🖼 写真を選択して追加
            </p>
            <p style={{ fontSize: '11px', color: '#8AAAC8', marginTop: '2px' }}>
              {totalCount}枚選択中{phase === 'done' ? `・${successCount}枚登録済み` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={isBusy ? undefined : handleCancel}
            disabled={isBusy}
            aria-label="閉じる"
            style={{
              width: '44px', height: '44px', borderRadius: '50%',
              background: '#F0F5FA', border: 'none', color: '#4878A8', fontSize: '16px',
              cursor: isBusy ? 'default' : 'pointer', opacity: isBusy ? 0.4 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>

        {/* ── 案内・警告 ── */}
        <div style={{ flexShrink: 0, padding: '10px 16px 0' }}>
          {usedThreeShotRule && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '9px 12px',
              background: '#F0F5FA', border: '1px solid #C8DCF0', borderRadius: '12px', marginBottom: '8px',
            }}>
              <span style={{ fontSize: '13px' }}>💡</span>
              <p style={{ fontSize: '11px', color: '#4878A8', lineHeight: 1.6 }}>
                3枚選択されたため、選んだ順に「正面・左45°・右45°」を仮に割り当てました。
                内容を確認し、違っていれば下の部位を変更してください。
              </p>
            </div>
          )}
          {files.length > RECOMMENDED_MAX_FILES && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '9px 12px',
              background: '#FFFBF0', border: '1px solid #F4E4C2', borderRadius: '12px', marginBottom: '8px',
            }}>
              <span style={{ fontSize: '13px' }}>⚠️</span>
              <p style={{ fontSize: '11px', color: '#9F7E6C', lineHeight: 1.6 }}>
                一度に{RECOMMENDED_MAX_FILES}枚を超えると変換・登録に時間がかかる場合があります。
                目安として一度に{RECOMMENDED_MAX_FILES}枚程度までの選択を推奨します。
              </p>
            </div>
          )}
        </div>

        {/* ── 一覧(スクロール領域) ── */}
        <div style={{
          flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch',
          padding: '8px 16px 16px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
          gap: '12px',
          alignContent: 'start',
        }}>
          {items.length === 0 && (
            <p style={{ gridColumn: '1 / -1', textAlign: 'center', fontSize: '12px', color: '#8AAAC8', padding: '24px 0' }}>
              写真がありません
            </p>
          )}
          <AnimatePresence>
            {items.map((item, idx) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.15 }}
                style={{
                  background: '#fff', borderRadius: '16px', overflow: 'hidden',
                  border: `1.5px solid ${item.status === 'error' ? '#F5C0C8' : item.status === 'success' ? '#B7E4C7' : '#E4EEF8'}`,
                  display: 'flex', flexDirection: 'column',
                }}
              >
                <div style={{ position: 'relative', aspectRatio: '1 / 1', background: '#EEE' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.previewUrl}
                    alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                  <span style={{
                    position: 'absolute', top: '6px', left: '6px',
                    fontSize: '10px', fontWeight: 700, color: '#fff',
                    background: 'rgba(0,0,0,0.55)', borderRadius: '999px', padding: '2px 8px',
                  }}>
                    {idx + 1}
                  </span>
                  {item.status === 'success' && (
                    <span style={{
                      position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'rgba(24,120,80,0.35)', color: '#fff', fontSize: '24px', fontWeight: 700,
                    }}>✓</span>
                  )}
                  {item.status === 'uploading' && (
                    <span style={{
                      position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'rgba(0,0,0,0.35)', color: '#fff', fontSize: '11px',
                    }}>アップロード中…</span>
                  )}
                  {!isBusy && item.status !== 'success' && (
                    <button
                      type="button"
                      onClick={() => removeItem(item.id)}
                      aria-label="この写真を削除"
                      style={{
                        position: 'absolute', top: '4px', right: '4px',
                        width: '28px', height: '28px', borderRadius: '50%',
                        background: 'rgba(0,0,0,0.55)', color: '#fff', border: 'none',
                        fontSize: '13px', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>

                <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <p style={{
                    fontSize: '10px', color: '#9F7E6C', whiteSpace: 'nowrap', overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }} title={item.file.name}>
                    {item.file.name}
                  </p>

                  {item.isProvisional && (
                    <span style={{
                      alignSelf: 'flex-start', fontSize: '9px', fontWeight: 700, color: '#4878A8',
                      background: '#F0F5FA', border: '1px solid #C8DCF0', borderRadius: '999px', padding: '1px 8px',
                    }}>
                      {bodyPartLabel(item.bodyPart)}(仮)
                    </span>
                  )}

                  <select
                    value={item.bodyPart}
                    onChange={(e) => updateBodyPart(item.id, e.target.value)}
                    disabled={isBusy || item.status === 'success'}
                    style={{
                      width: '100%', fontSize: '12px', color: '#3d4858', padding: '7px 8px',
                      borderRadius: '8px', border: '1.5px solid rgba(72,120,168,0.3)', background: '#fff',
                    }}
                  >
                    {BODY_PART_OPTIONS.map(opt => (
                      <option key={opt.id} value={opt.id}>{opt.label}</option>
                    ))}
                  </select>

                  {item.status === 'error' && (
                    <p style={{ fontSize: '10px', color: '#C05060' }}>
                      登録に失敗しました{item.error ? `（${item.error}）` : ''}
                    </p>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* ── フッター ── */}
        <div style={{
          flexShrink: 0, padding: '12px 16px', borderTop: '1px solid #E4EEF8', background: '#fff',
          paddingBottom: 'max(16px, env(safe-area-inset-bottom))',
        }}>
          {phase === 'done' && (
            <p style={{ fontSize: '12px', color: hasFailures ? '#C05060' : '#2D6A4F', fontWeight: 600, marginBottom: '8px', textAlign: 'center' }}>
              {totalCount}枚中{successCount}枚登録しました{hasFailures ? `（${errorCount}枚失敗）` : ''}
            </p>
          )}

          <div style={{ display: 'flex', gap: '8px' }}>
            {phase !== 'done' ? (
              <>
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={isBusy}
                  style={{
                    flex: 1, padding: '13px', borderRadius: '999px', fontSize: '13px', fontWeight: 600,
                    background: '#fff', color: '#688098', border: '1.5px solid #C8DCF0',
                    cursor: isBusy ? 'default' : 'pointer', opacity: isBusy ? 0.5 : 1,
                  }}
                >
                  登録キャンセル
                </button>
                <button
                  type="button"
                  onClick={handleRegister}
                  disabled={isBusy || items.length === 0}
                  style={{
                    flex: 2, padding: '13px', borderRadius: '999px', fontSize: '13px', fontWeight: 700,
                    background: isBusy || items.length === 0 ? '#A0BCD8' : '#4878A8', color: '#fff', border: 'none',
                    cursor: isBusy || items.length === 0 ? 'default' : 'pointer',
                  }}
                >
                  {isBusy ? '登録中…' : `一括登録（${items.length}件）`}
                </button>
              </>
            ) : hasFailures ? (
              <>
                <button
                  type="button"
                  onClick={handleCancel}
                  style={{
                    flex: 1, padding: '13px', borderRadius: '999px', fontSize: '13px', fontWeight: 600,
                    background: '#fff', color: '#688098', border: '1.5px solid #C8DCF0', cursor: 'pointer',
                  }}
                >
                  閉じる
                </button>
                <button
                  type="button"
                  onClick={handleRetryFailed}
                  style={{
                    flex: 2, padding: '13px', borderRadius: '999px', fontSize: '13px', fontWeight: 700,
                    background: '#C05060', color: '#fff', border: 'none', cursor: 'pointer',
                  }}
                >
                  失敗した{errorCount}枚を再送
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handleCancel}
                style={{
                  flex: 1, padding: '13px', borderRadius: '999px', fontSize: '13px', fontWeight: 700,
                  background: '#4878A8', color: '#fff', border: 'none', cursor: 'pointer',
                }}
              >
                完了
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
