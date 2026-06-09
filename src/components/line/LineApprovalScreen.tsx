'use client'
/**
 * LineApprovalScreen.tsx — LINE 送信承認画面
 * マウント時にキューを自動生成（1日1回）。
 * pending / approved のキューを一覧表示。
 * 承認・スキップ・本文編集が可能。
 * 実際の LINE 送信は未実装（送信ボタンは表示のみ）。
 */
import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, X, Edit3, Send, RefreshCw, Clock, Sparkles } from 'lucide-react'
import { useLineSendQueueStore }                         from '@/store/useLineSendQueueStore'
import { useCustomerStore }                              from '@/store/useCustomerStore'
import { generateQueueForCustomers, shouldRunToday }     from '@/lib/line/lineQueueGenerator'
import AppBottomNav from '@/components/phase1/AppBottomNav'
import type { LineSendQueue } from '@/types'

// ─── ステータスバッジ ─────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  pending:  '承認待ち',
  approved: '承認済み',
  sent:     '送信済み',
  failed:   '失敗',
  skipped:  'スキップ',
}
const STATUS_COLOR: Record<string, string> = {
  pending:  '#F56E8B',
  approved: '#52B788',
  sent:     '#74C69D',
  failed:   '#EF476F',
  skipped:  '#C8A8B0',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span style={{
      fontSize: '9px', fontWeight: 700, padding: '2px 8px',
      borderRadius: '999px',
      background: (STATUS_COLOR[status] ?? '#C8A8B0') + '22',
      color:       STATUS_COLOR[status] ?? '#C8A8B0',
      border:      `1px solid ${STATUS_COLOR[status] ?? '#C8A8B0'}44`,
      whiteSpace:  'nowrap',
    }}>
      {STATUS_LABEL[status] ?? status}
    </span>
  )
}

// ─── キューアイテムカード ─────────────────────────────────────────────────────

function QueueCard({ item }: { item: LineSendQueue }) {
  const { approveItem, skipItem, editMessage } = useLineSendQueueStore()
  const [editing,  setEditing]  = useState(false)
  const [body,     setBody]     = useState(item.message_body)
  const [loading,  setLoading]  = useState(false)

  const handleApprove = useCallback(async () => {
    setLoading(true)
    await approveItem(item.id)
    setLoading(false)
  }, [approveItem, item.id])

  const handleSkip = useCallback(async () => {
    setLoading(true)
    await skipItem(item.id)
    setLoading(false)
  }, [skipItem, item.id])

  const handleSave = useCallback(async () => {
    await editMessage(item.id, body)
    setEditing(false)
  }, [editMessage, item.id, body])

  const createdAgo = Math.round(
    (Date.now() - new Date(item.created_at).getTime()) / 60000
  )
  const agoLabel = createdAgo < 60
    ? `${createdAgo}分前`
    : `${Math.round(createdAgo / 60)}時間前`

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      style={{
        background: '#fff', border: '1px solid #F5EEF0',
        borderRadius: '16px', overflow: 'hidden',
        marginBottom: '10px',
      }}
    >
      {/* ヘッダー */}
      <div style={{
        padding: '10px 14px',
        background: item.status === 'approved'
          ? 'linear-gradient(135deg, #F0FFF8, #FAFFFC)'
          : 'linear-gradient(135deg, #FFF8F7, #FFFBF8)',
        borderBottom: '1px solid #F5EEF0',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#5C4033' }}>
            {item.customer_name}
          </span>
          <StatusBadge status={item.status} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <Clock size={10} color="#C8A8B0" />
          <span style={{ fontSize: '10px', color: '#C8A8B0' }}>{agoLabel}</span>
        </div>
      </div>

      {/* メッセージ本文 */}
      <div style={{ padding: '12px 14px' }}>
        {editing ? (
          <div>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              style={{
                width: '100%', minHeight: '80px', padding: '8px 10px',
                border: '1px solid #F0E8E8', borderRadius: '10px',
                fontSize: '12px', color: '#5C4033', resize: 'vertical',
                lineHeight: 1.6, outline: 'none', background: '#FFFBF8',
              }}
            />
            <div style={{ display: 'flex', gap: '6px', marginTop: '8px', justifyContent: 'flex-end' }}>
              <button onClick={() => { setBody(item.message_body); setEditing(false) }}
                style={{ fontSize: '11px', padding: '5px 12px', borderRadius: '8px',
                  border: '1px solid #F0E8E8', background: 'transparent', color: '#C8A8B0', cursor: 'pointer' }}>
                キャンセル
              </button>
              <button onClick={handleSave}
                style={{ fontSize: '11px', padding: '5px 12px', borderRadius: '8px',
                  border: 'none', background: '#F56E8B', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
                保存
              </button>
            </div>
          </div>
        ) : (
          <p style={{
            fontSize: '12px', color: '#5C4033', lineHeight: 1.7,
            whiteSpace: 'pre-wrap', margin: 0,
          }}>
            {item.message_body}
          </p>
        )}

        {/* トリガー情報 */}
        {item.triggered_by && (
          <p style={{ fontSize: '10px', color: '#C8A8B0', marginTop: '8px', lineHeight: 1.5 }}>
            {item.triggered_by.startsWith('score:')
              ? (() => {
                  const [scorePart, ...rest] = item.triggered_by.split(' / ')
                  const score = scorePart.replace('score:', '')
                  return (
                    <>
                      <span style={{
                        fontSize: '9px', fontWeight: 700, padding: '1px 6px',
                        borderRadius: '4px', background: '#F56E8B22', color: '#F56E8B',
                        marginRight: '4px',
                      }}>
                        優先度 {score}点
                      </span>
                      {rest.join(' / ')}
                    </>
                  )
                })()
              : item.triggered_by === 'churn_risk'      ? '🚨 離脱リスク検知'
              : item.triggered_by === 'vip_candidate'   ? '👑 VIP候補'
              : item.triggered_by === 'product_suggest' ? '🛍️ 店販提案タイミング'
              : item.triggered_by === 'manual'          ? '手動'
              : item.triggered_by
            }
          </p>
        )}

        {/* 送信失敗時のエラー内容 */}
        {item.status === 'failed' && item.error_message && (
          <p style={{
            fontSize: '10px', color: '#EF476F', marginTop: '8px', lineHeight: 1.5,
            background: '#FFF0F0', border: '1px solid #FCCDD8',
            borderRadius: '8px', padding: '6px 8px',
          }}>
            ⚠️ 送信エラー: {item.error_message}
          </p>
        )}

        {/* 送信日時 */}
        {item.status === 'sent' && item.sent_at && (
          <p style={{ fontSize: '10px', color: '#74C69D', marginTop: '8px' }}>
            ✅ 送信完了: {new Date(item.sent_at).toLocaleString('ja-JP')}
          </p>
        )}
      </div>

      {/* アクションボタン */}
      {!editing && item.status === 'pending' && (
        <div style={{
          padding: '10px 14px',
          borderTop: '1px solid #F5EEF0',
          display: 'flex', gap: '8px',
        }}>
          <button onClick={() => setEditing(true)}
            disabled={loading}
            style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              padding: '7px 12px', borderRadius: '10px',
              border: '1px solid #F0E8E8', background: 'transparent',
              color: '#C8A8B0', fontSize: '11px', cursor: 'pointer',
            }}>
            <Edit3 size={12} /> 編集
          </button>
          <button onClick={handleSkip}
            disabled={loading}
            style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              padding: '7px 12px', borderRadius: '10px',
              border: '1px solid #FCCDD8', background: '#FFF0F0',
              color: '#EF476F', fontSize: '11px', cursor: 'pointer',
            }}>
            <X size={12} /> スキップ
          </button>
          <button onClick={handleApprove}
            disabled={loading}
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
              padding: '7px 12px', borderRadius: '10px',
              border: 'none',
              background: loading ? '#F5EEF0' : 'linear-gradient(135deg, #52B788, #40A872)',
              color: loading ? '#C8A8B0' : '#fff',
              fontSize: '11px', fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
            }}>
            <Check size={12} /> 承認
          </button>
        </div>
      )}

      {/* 承認済み（送信処理中 / 結果待ち） */}
      {!editing && item.status === 'approved' && (
        <div style={{
          padding: '10px 14px',
          borderTop: '1px solid #F5EEF0',
          display: 'flex', alignItems: 'center', gap: '6px',
        }}>
          <Send size={12} color="#74C69D" />
          <span style={{ fontSize: '11px', color: '#74C69D', fontWeight: 600 }}>
            承認済み・送信処理中…
          </span>
        </div>
      )}
    </motion.div>
  )
}

// ─── メイン画面 ───────────────────────────────────────────────────────────────

export default function LineApprovalScreen() {
  const { queue, isLoading, fetchQueue } = useLineSendQueueStore()
  const customers = useCustomerStore(s => s.customers)
  const fetchCustomers = useCustomerStore(s => s.fetchCustomers)
  const [generating, setGenerating] = useState(false)
  const [genResult,  setGenResult]  = useState<{ created: number; errors: string[] } | null>(null)

  useEffect(() => {
    // 顧客データがなければ取得
    if (customers.length === 0) fetchCustomers()
  }, [customers.length, fetchCustomers])

  useEffect(() => {
    // 顧客データ取得後にキュー生成 → fetchQueue
    if (customers.length === 0 || !shouldRunToday()) {
      fetchQueue()
      return
    }

    setGenerating(true)
    generateQueueForCustomers(customers)
      .then(result => {
        setGenResult({ created: result.created, errors: result.errors })
      })
      .catch(e => console.error('[LineApproval] generateQueue error:', e))
      .finally(() => {
        setGenerating(false)
        fetchQueue()
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers.length])

  const pending  = queue.filter(q => q.status === 'pending')
  const approved = queue.filter(q => q.status === 'approved')
  const sent     = queue.filter(q => q.status === 'sent')
  const failed   = queue.filter(q => q.status === 'failed')
  const skipped  = queue.filter(q => q.status === 'skipped')

  return (
    <div
      className="min-h-dvh max-w-[430px] mx-auto"
      style={{
        background: 'linear-gradient(160deg, #F8F1F3 0%, #FDF7F8 50%, #F8EFF0 100%)',
        paddingBottom: 'calc(80px + max(12px, env(safe-area-inset-bottom)))',
      }}
    >
      {/* ヘッダー */}
      <div style={{
        padding: 'max(52px, calc(env(safe-area-inset-top) + 16px)) 20px 16px',
        background: 'rgba(253,247,248,0.92)',
        borderBottom: '1px solid #F5EEF0',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <p style={{ fontSize: '11px', color: '#C8A58C', fontWeight: 600, letterSpacing: '0.1em' }}>
            LINE
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <p style={{ fontSize: '18px', fontWeight: 700, color: '#5C4033' }}>
              送信承認
            </p>
            {generating && (
              <span style={{
                fontSize: '9px', padding: '2px 8px', borderRadius: '999px',
                background: '#F56E8B22', color: '#F56E8B',
                border: '1px solid #F56E8B44', fontWeight: 600,
              }}>
                生成中…
              </span>
            )}
            {!generating && genResult && genResult.created > 0 && (
              <span style={{
                fontSize: '9px', padding: '2px 8px', borderRadius: '999px',
                background: '#52B78822', color: '#52B788',
                border: '1px solid #52B78844', fontWeight: 600,
              }}>
                <Sparkles size={9} style={{ display: 'inline', marginRight: '2px' }} />
                {genResult.created}件 自動生成
              </span>
            )}
          </div>
        </div>
        <button
          onClick={fetchQueue}
          style={{
            width: '36px', height: '36px', borderRadius: '999px',
            border: '1px solid #F5E6E8', background: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <motion.span
            animate={isLoading ? { rotate: 360 } : { rotate: 0 }}
            transition={isLoading ? { repeat: Infinity, duration: 1, ease: 'linear' } : {}}
          >
            <RefreshCw size={14} color="#D98292" />
          </motion.span>
        </button>
      </div>

      <div style={{ padding: '16px 16px 0' }}>

        {/* サマリーバー */}
        <div style={{
          display: 'flex', gap: '8px', marginBottom: '16px',
        }}>
          {[
            { label: '承認待ち', count: pending.length,  color: '#F56E8B' },
            { label: '承認済み', count: approved.length, color: '#52B788' },
            { label: '送信済み', count: sent.length,     color: '#74C69D' },
            { label: '失敗',     count: failed.length,   color: '#EF476F' },
          ].map(({ label, count, color }) => (
            <div key={label} style={{
              flex: 1, background: '#fff', borderRadius: '14px',
              border: `1px solid ${color}33`, padding: '10px 12px', textAlign: 'center',
            }}>
              <p style={{ fontSize: '9px', color: '#C8A8B0', marginBottom: '2px' }}>{label}</p>
              <p style={{ fontSize: '22px', fontWeight: 700, color, fontFamily: 'Inter, sans-serif' }}>
                {count}
              </p>
            </div>
          ))}
        </div>

        {/* ローディング */}
        {isLoading && (
          <div style={{ textAlign: 'center', padding: '32px' }}>
            <p style={{ fontSize: '12px', color: '#C8A8B0' }}>読み込み中...</p>
          </div>
        )}

        {/* 空状態 */}
        {!isLoading && queue.length === 0 && (
          <div style={{
            background: '#fff', borderRadius: '18px', padding: '32px',
            textAlign: 'center', border: '1px solid #F5EEF0',
          }}>
            <p style={{ fontSize: '24px', marginBottom: '8px' }}>✉️</p>
            <p style={{ fontSize: '13px', fontWeight: 600, color: '#5C4033', marginBottom: '4px' }}>
              承認待ちのメッセージはありません
            </p>
            <p style={{ fontSize: '11px', color: '#C8A8B0' }}>
              離脱リスクが高い顧客への送信候補が<br />ここに表示されます
            </p>
          </div>
        )}

        {/* 承認待ち */}
        {!isLoading && pending.length > 0 && (
          <>
            <p style={{ fontSize: '11px', color: '#C8A8B0', fontWeight: 600,
              marginBottom: '8px', letterSpacing: '0.05em' }}>
              承認待ち
            </p>
            <AnimatePresence>
              {pending.map(item => <QueueCard key={item.id} item={item} />)}
            </AnimatePresence>
          </>
        )}

        {/* 承認済み */}
        {!isLoading && approved.length > 0 && (
          <>
            <p style={{ fontSize: '11px', color: '#C8A8B0', fontWeight: 600,
              marginBottom: '8px', marginTop: '8px', letterSpacing: '0.05em' }}>
              承認済み（送信処理中）
            </p>
            <AnimatePresence>
              {approved.map(item => <QueueCard key={item.id} item={item} />)}
            </AnimatePresence>
          </>
        )}

        {/* 失敗 */}
        {!isLoading && failed.length > 0 && (
          <>
            <p style={{ fontSize: '11px', color: '#EF476F', fontWeight: 600,
              marginBottom: '8px', marginTop: '8px', letterSpacing: '0.05em' }}>
              送信失敗
            </p>
            <AnimatePresence>
              {failed.map(item => <QueueCard key={item.id} item={item} />)}
            </AnimatePresence>
          </>
        )}

        {/* 送信済み */}
        {!isLoading && sent.length > 0 && (
          <>
            <p style={{ fontSize: '11px', color: '#C8A8B0', fontWeight: 600,
              marginBottom: '8px', marginTop: '8px', letterSpacing: '0.05em' }}>
              送信済み
            </p>
            <AnimatePresence>
              {sent.map(item => <QueueCard key={item.id} item={item} />)}
            </AnimatePresence>
          </>
        )}

        {/* スキップ */}
        {!isLoading && skipped.length > 0 && (
          <>
            <p style={{ fontSize: '11px', color: '#C8A8B0', fontWeight: 600,
              marginBottom: '8px', marginTop: '8px', letterSpacing: '0.05em' }}>
              スキップ済み
            </p>
            <AnimatePresence>
              {skipped.map(item => <QueueCard key={item.id} item={item} />)}
            </AnimatePresence>
          </>
        )}

      </div>

      <AppBottomNav />
    </div>
  )
}
