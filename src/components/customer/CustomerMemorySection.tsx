'use client'

/**
 * CustomerMemorySection — 「覚えておくこと」ブリーフィング（Phase 2）
 *
 * 表示優先順:
 *   1. trigger_date 7日以内
 *   2. trigger_date 30日以内
 *   3. その他（日付なし / 30日超）
 *   ※ is_sensitive=true は「⚠ 触れない話題」として別枠表示
 *
 * 絶対ルール: このコンポーネントのデータを ProposalOrchestrator /
 * FireScore / AI提案 / LINE提案 へ渡さないこと。
 */

import { useEffect, useState, useCallback } from 'react'
import type { CustomerMemory, MemoryType } from '@/types/customerMemory'
import { MEMORY_TYPE_EMOJI } from '@/types/customerMemory'

interface Props {
  customerId: string
  onManage:   () => void
}

// ── ソート用グループ ─────────────────────────────────────────────────────────

const IMPORTANCE_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 }

function daysUntil(dateStr: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(dateStr)
  target.setHours(0, 0, 0, 0)
  return Math.ceil((target.getTime() - today.getTime()) / 86_400_000)
}

function getSortGroup(m: CustomerMemory): number {
  if (!m.trigger_date) return 3
  const d = daysUntil(m.trigger_date)
  if (d === 0)        return 0  // 今日
  if (d > 0 && d <= 7)  return 1  // 7日以内
  if (d > 7 && d <= 30) return 2  // 30日以内
  if (d < 0)          return 4  // 過去
  return 3                       // 30日超
}

function sortMemories(arr: CustomerMemory[]): CustomerMemory[] {
  return [...arr].sort((a, b) => {
    const gDiff = getSortGroup(a) - getSortGroup(b)
    if (gDiff !== 0) return gDiff
    // 同グループ内: 日付あり同士は近い順
    if (a.trigger_date && b.trigger_date) {
      const dDiff = Math.abs(daysUntil(a.trigger_date)) - Math.abs(daysUntil(b.trigger_date))
      if (dDiff !== 0) return dDiff
    }
    const impDiff = (IMPORTANCE_ORDER[a.importance] ?? 1) - (IMPORTANCE_ORDER[b.importance] ?? 1)
    if (impDiff !== 0) return impDiff
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
}

// ── 1行テキスト生成 ──────────────────────────────────────────────────────────

function formatLine(m: CustomerMemory): string {
  if (m.trigger_date) {
    const d = daysUntil(m.trigger_date)
    if (d === 0)        return `${m.content}（今日）`
    if (d > 0 && d <= 30) return `${m.content}まで${d}日`
  }
  return m.content
}

// ── コンポーネント ────────────────────────────────────────────────────────────

export default function CustomerMemorySection({ customerId, onManage }: Props) {
  const [memories, setMemories] = useState<CustomerMemory[]>([])
  const [loading,  setLoading]  = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(
        `/api/customer-memories?customer_id=${encodeURIComponent(customerId)}`
      )
      if (!res.ok) return
      const { memories: data } = await res.json() as { memories: CustomerMemory[] }
      setMemories(sortMemories(data))
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [customerId])

  useEffect(() => { load() }, [load])

  if (loading || memories.length === 0) return null

  const normal    = memories.filter(m => !m.is_sensitive).slice(0, 5)
  const sensitive = memories.filter(m => m.is_sensitive)

  return (
    <div
      className="rounded-[18px] overflow-hidden"
      style={{
        border:     '1.5px solid rgba(245,110,139,0.22)',
        background: 'linear-gradient(135deg, #FFFBFC 0%, #FFF7F9 100%)',
        boxShadow:  '0 2px 12px rgba(245,110,139,0.07)',
      }}
    >
      {/* ヘッダー */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-bold text-[#F56E8B] tracking-[0.06em]">
            💌 覚えておくこと
          </span>
        </div>
        <button
          onClick={onManage}
          className="text-[10px] font-medium px-2.5 py-0.5 rounded-full border-none cursor-pointer"
          style={{ background: 'rgba(245,110,139,0.1)', color: '#F56E8B' }}
        >
          管理
        </button>
      </div>

      {/* メモリー一覧 */}
      {normal.length > 0 && (
        <div className="px-4 pb-3 flex flex-col gap-2">
          {normal.map(m => {
            const group = getSortGroup(m)
            const isUrgent = group <= 1   // 今日 or 7日以内
            const isSoon   = group === 2  // 30日以内
            const emoji    = MEMORY_TYPE_EMOJI[m.memory_type as MemoryType] ?? '📝'
            const line     = formatLine(m)

            return (
              <div key={m.id} className="flex items-center gap-2 min-w-0">
                <span className="text-sm flex-shrink-0">{emoji}</span>
                <span
                  className="text-[12px] leading-snug truncate"
                  style={{
                    color:      isUrgent ? '#D04060' : '#5C4033',
                    fontWeight: isUrgent ? 700 : isSoon ? 600 : 400,
                  }}
                >
                  {line}
                </span>
                {isUrgent && (
                  <span
                    className="flex-shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                    style={{ background: 'rgba(245,110,139,0.15)', color: '#E03060' }}
                  >
                    urgent
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ⚠ 触れない話題（センシティブ） */}
      {sensitive.length > 0 && (
        <div
          className="mx-3 mb-3 rounded-[12px] px-3 py-2"
          style={{ background: 'rgba(200,70,80,0.06)', border: '1px solid rgba(200,70,80,0.15)' }}
        >
          <p className="text-[10px] font-bold text-[#C84650] mb-1.5 tracking-wide">
            ⚠ 触れない話題
          </p>
          <div className="flex flex-col gap-1">
            {sensitive.map(m => (
              <div key={m.id} className="flex items-center gap-1.5">
                <span className="text-xs flex-shrink-0">
                  {MEMORY_TYPE_EMOJI[m.memory_type as MemoryType] ?? '📝'}
                </span>
                <span className="text-[11px] text-[#8A3040] leading-snug truncate">
                  {m.content}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
