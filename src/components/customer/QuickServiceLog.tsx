'use client'
import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useStaffStore } from '@/store/useStaffStore'
import { logEdit } from '@/lib/audit'
import type { Reservation } from '@/types'

export type ServiceLogData = {
  aiAdopted: boolean
  nextReserved: boolean
  optionSold: boolean
  retailSold: boolean
  churnFollowed: boolean
}

// ── アクション定義 ──────────────────────────────────────────────────
const ACTIONS = [
  { key: 'ai_adopted',     emoji: '✨', label: 'AI提案\n活用した',  color: 'bg-amber-50'   },
  { key: 'next_reserved',  emoji: '📅', label: '次回予約\n取れた',  color: 'bg-emerald-50' },
  { key: 'option_sold',    emoji: '💎', label: 'オプション\n提案',  color: 'bg-sky-50'     },
  { key: 'retail_sold',    emoji: '🛍', label: '物販\n売れた',      color: 'bg-violet-50'  },
  { key: 'churn_followed', emoji: '💌', label: '離脱\nフォロー',    color: 'bg-rose-50'    },
] as const

type ActionKey = typeof ACTIONS[number]['key']

export type Props = {
  reservation: Pick<Reservation, 'id' | 'customer_id' | 'customer_hash_id'> | null
  onComplete?: (data: ServiceLogData) => void
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid  = (s: string | null | undefined): s is string => !!s && UUID_RE.test(s)

function haptic(ms: number | number[]) {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(ms)
}

// ── コンポーネント ──────────────────────────────────────────────────
export default function QuickServiceLog({ reservation, onComplete }: Props) {
  const { currentStaffId } = useStaffStore()
  const [selected,  setSelected]  = useState<Set<ActionKey>>(new Set())
  const [saving,    setSaving]    = useState(false)
  const [completed, setCompleted] = useState(false)

  // ── ボタントグル（DB 書き込みなし）──────────────────────────────
  const toggle = useCallback((key: ActionKey) => {
    haptic(8)
    setSelected(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }, [])

  // ── 接客完了 → 1回の INSERT ──────────────────────────────────────
  const completeSession = useCallback(async () => {
    if (saving || completed) return

    if (!currentStaffId) {
      haptic(80)
      toast.error('ログインが必要です')
      return
    }

    haptic(15)
    setSaving(true)

    const payload = {
      reservation_id:    isUuid(reservation?.id)          ? reservation!.id          : null,
      customer_id:       isUuid(reservation?.customer_id) ? reservation!.customer_id : null,
      staff_id:          null,
      ai_adopted:        selected.has('ai_adopted'),
      next_reserved:     selected.has('next_reserved'),
      option_sold:       selected.has('option_sold'),
      retail_sold:       selected.has('retail_sold'),
      churn_followed:    selected.has('churn_followed'),
      service_completed: true,
    }

    const { error } = await supabase.from('staff_logs').insert(payload)

    if (error) {
      console.error('[QuickServiceLog] complete:', error)
      toast.error('保存に失敗しました', { description: error.message })
      setSaving(false)
      return
    }

    // ── 監査ログ + AIタグ更新（fire-and-forget） ───────────────────────────
    const customerId = payload.customer_id
    if (customerId) {
      const services = ACTIONS
        .filter(a => selected.has(a.key))
        .map(a => a.label.replace('\n', ''))
        .join(', ')

      // 監査ログ
      logEdit(customerId, 'service_log', { services: Array.from(selected) })

      // AIタグ更新 Edge Function（短文分類のみ、軽量）
      const logText = `接客完了。実施内容: ${services || 'なし'}`
      supabase.functions.invoke('update-ai-tags', {
        body: { customer_id: customerId, log_text: logText },
      }).then(() => {}).catch(() => { /* タグ更新失敗は無視 */ })

      // 次回来店推奨日を計算して customers に保存（30日後をデフォルト）
      const nextVisit = new Date()
      nextVisit.setDate(nextVisit.getDate() + 30)
      void supabase
        .from('customers')
        .update({ next_visit_date: nextVisit.toISOString().split('T')[0] })
        .eq('id', customerId)
    }

    haptic([20, 40, 20])
    setCompleted(true)
    setSaving(false)
    toast.success('接客記録を保存しました 🌸', { duration: 2500 })
    setTimeout(() => onComplete?.({
      aiAdopted: selected.has('ai_adopted'),
      nextReserved: selected.has('next_reserved'),
      optionSold: selected.has('option_sold'),
      retailSold: selected.has('retail_sold'),
      churnFollowed: selected.has('churn_followed'),
    }), 1200)
  }, [saving, completed, currentStaffId, reservation, selected, onComplete])

  if (completed) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center justify-center py-6 gap-3"
      >
        <motion.div
          animate={{ scale: [1, 1.15, 1] }}
          transition={{ duration: 0.5 }}
          className="text-4xl"
        >
          🌸
        </motion.div>
        <p className="text-[14px] font-medium text-[#5C4033]">接客完了！お疲れ様でした</p>
        {selected.size > 0 && (
          <div className="flex flex-wrap justify-center gap-1.5 mt-1">
            {ACTIONS.filter(a => selected.has(a.key)).map(a => (
              <span key={a.key} className="text-[11px] bg-emerald-50 text-emerald-600 px-3 py-1 rounded-full">
                {a.emoji} {a.label.replace('\n', '')}
              </span>
            ))}
          </div>
        )}
      </motion.div>
    )
  }

  return (
    <div>
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] text-[#C8A58C] tracking-widest font-medium">TODAY&apos;S LOG</p>
        <AnimatePresence>
          {selected.size > 0 && (
            <motion.span
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="text-[10px] text-emerald-500 font-medium"
            >
              {selected.size}件 選択中
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* ── アクションボタン 2列グリッド ─────────────────────────── */}
      <div className="grid grid-cols-2 gap-2.5">
        {ACTIONS.map(({ key, emoji, label, color }) => {
          const isOn = selected.has(key)
          return (
            <motion.button
              key={key}
              whileTap={{ scale: 0.93 }}
              onClick={() => toggle(key)}
              className={[
                'relative flex flex-col items-center justify-center gap-2',
                'py-5 px-3 rounded-3xl border transition-all duration-200',
                isOn
                  ? 'bg-emerald-50 border-emerald-300 shadow-md shadow-emerald-100'
                  : `${color} border-[#F0E6D9]`,
              ].join(' ')}
            >
              {/* チェックバッジ */}
              <AnimatePresence>
                {isOn && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                    className="absolute top-2.5 right-2.5 w-4 h-4 bg-emerald-400 rounded-full flex items-center justify-center"
                  >
                    <span className="text-white text-[9px] font-bold">✓</span>
                  </motion.div>
                )}
              </AnimatePresence>

              <span className="text-[28px] leading-none">{emoji}</span>
              <p className={[
                'text-[12px] font-medium text-center leading-snug whitespace-pre-line',
                isOn ? 'text-emerald-700' : 'text-[#5C4033]',
              ].join(' ')}>
                {label}
              </p>
            </motion.button>
          )
        })}
      </div>

      {/* ── 接客完了ボタン ────────────────────────────────────────── */}
      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={completeSession}
        disabled={saving}
        className="mt-5 w-full py-4 rounded-full flex items-center justify-center gap-2
                   text-[15px] font-semibold tracking-wide transition-all"
        style={saving
          ? { background: '#F5D6DB', color: '#C8A58C', cursor: 'not-allowed' }
          : { background: '#F56E8B', color: '#FFFFFF', boxShadow: '0 8px 24px rgba(245,110,139,0.35)' }
        }
      >
        {saving ? (
          <>
            <motion.span
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }}
            >
              ⏳
            </motion.span>
            保存中...
          </>
        ) : (
          <> 🌸 接客ログを保存する </>
        )}
      </motion.button>

      {!currentStaffId && (
        <p className="mt-2 text-center text-[10px] text-[#C8A58C]">
          ⚠️ ログイン後にログが保存されます
        </p>
      )}
    </div>
  )
}
