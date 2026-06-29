'use client'

/**
 * CustomerMemorySection — 「覚えておくこと」ブリーフィング表示（読み取り専用）
 *
 * 表示順: ① trigger_date 近い順（past dates last）
 *         ② importance: high → medium → low
 *         ③ created_at 降順
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

const IMPORTANCE_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 }

function daysUntil(dateStr: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(dateStr)
  target.setHours(0, 0, 0, 0)
  return Math.ceil((target.getTime() - today.getTime()) / 86_400_000)
}

function sortMemories(memories: CustomerMemory[]): CustomerMemory[] {
  return [...memories].sort((a, b) => {
    // trigger_date がある場合: 近い将来が先（過去は後）
    const aHasDate = !!a.trigger_date
    const bHasDate = !!b.trigger_date
    if (aHasDate !== bHasDate) return aHasDate ? -1 : 1
    if (aHasDate && bHasDate) {
      const aDays = daysUntil(a.trigger_date!)
      const bDays = daysUntil(b.trigger_date!)
      // 両方未来 or 両方過去の場合は絶対値の小さい方が先
      const aAbs = Math.abs(aDays)
      const bAbs = Math.abs(bDays)
      if (aAbs !== bAbs) return aAbs - bAbs
    }
    // importance 順
    const impDiff = (IMPORTANCE_ORDER[a.importance] ?? 1) - (IMPORTANCE_ORDER[b.importance] ?? 1)
    if (impDiff !== 0) return impDiff
    // created_at 降順
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
}

function TriggerBadge({ dateStr }: { dateStr: string }) {
  const days = daysUntil(dateStr)
  if (days > 0 && days <= 30) {
    return (
      <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
        style={{ background: 'rgba(245,110,139,0.12)', color: '#F56E8B' }}>
        あと{days}日
      </span>
    )
  }
  if (days === 0) {
    return (
      <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
        style={{ background: 'rgba(245,110,139,0.2)', color: '#D04060' }}>
        今日
      </span>
    )
  }
  return null
}

export default function CustomerMemorySection({ customerId, onManage }: Props) {
  const [memories, setMemories] = useState<CustomerMemory[]>([])
  const [loading,  setLoading]  = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/customer-memories?customer_id=${encodeURIComponent(customerId)}`)
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

  const highImportance = memories.filter(m => m.importance === 'high' && !m.is_sensitive)
  const others         = memories.filter(m => m.importance !== 'high' && !m.is_sensitive)
  const sensitive      = memories.filter(m => m.is_sensitive)
  const displayed      = [...highImportance, ...others].slice(0, 5)

  if (loading) return null

  return (
    <div className="rounded-[18px] overflow-hidden"
      style={{ border: '1px solid #F5EEF0', background: '#FFFBFC' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
        <span className="text-xs font-bold text-[#5C4033] tracking-wide">
          💌 覚えておくこと
        </span>
        <button
          onClick={onManage}
          className="text-[10px] font-medium px-2.5 py-1 rounded-full border-none cursor-pointer"
          style={{ background: 'rgba(245,110,139,0.1)', color: '#F56E8B' }}>
          管理
        </button>
      </div>

      {memories.length === 0 ? (
        <div className="px-4 pb-3.5">
          <p className="text-[11px] text-[#C8A8B0]">まだ登録されていません</p>
        </div>
      ) : (
        <div className="px-4 pb-3.5 flex flex-col gap-1.5">
          {displayed.map(m => (
            <div key={m.id} className="flex items-start gap-2">
              <span className="text-sm mt-0.5 flex-shrink-0">
                {MEMORY_TYPE_EMOJI[m.memory_type as MemoryType] ?? '📝'}
                {m.importance === 'high' && (
                  <span className="ml-0.5 text-[9px] align-top text-[#F56E8B]">!</span>
                )}
              </span>
              <div className="flex-1 min-w-0">
                <span className="text-[12px] text-[#5C4033] leading-snug break-words">
                  {m.content}
                </span>
                {m.trigger_date && <TriggerBadge dateStr={m.trigger_date} />}
              </div>
            </div>
          ))}

          {sensitive.length > 0 && (
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[10px] text-[#C8A8B0]">
                ⚠ センシティブ情報が{sensitive.length}件あります（管理から確認）
              </span>
            </div>
          )}

          {memories.length > 5 && (
            <button onClick={onManage}
              className="text-[10px] text-[#C8A8B0] mt-0.5 bg-transparent border-none cursor-pointer p-0 text-left">
              他{memories.length - 5}件を見る →
            </button>
          )}
        </div>
      )}
    </div>
  )
}
