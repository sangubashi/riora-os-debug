'use client'
/**
 * useNextVisit.ts — 次回目安エンジン(PHASE NEXT-VISIT-1)のクライアント側フック。
 *
 * GET/PATCH /api/customers/[id]/next-visit を呼ぶだけの薄いフック。計算ロジック自体は
 * サーバー側(app/api/customers/[id]/next-visit/route.ts)がnextVisitEngine.tsで行う。
 * IpadStaffKarteView・CustomerBottomSheet・CustomerModeViewの3画面が同じ挙動
 * (取得・手動上書きの設定/解除)を必要とするため、共通フックとして切り出す。
 */
import { useCallback, useEffect, useState } from 'react'
import { authedFetch } from '@/lib/api/authedFetch'
import type { NextVisitResult } from './nextVisitEngine'

export interface UseNextVisitState {
  loading: boolean
  result: NextVisitResult | null
  overrideDate: string | null
  saving: boolean
  /** dateにnullを渡すと上書きを解除する。成功時true。 */
  setOverride: (date: string | null) => Promise<boolean>
  /**
   * 明示的な再取得。CustomerBottomSheet(常時マウント)とIpadStaffKarteView/
   * CustomerModeView(portalで都度マウント)はそれぞれ別々にuseNextVisitを呼ぶため、
   * 一方でsetOverrideしても他方の表示は自動更新されない。呼び出し元(例:
   * IpadStaffKarteViewのonClose)がこのrefetchを呼んで最新値に揃える。
   */
  refetch: () => Promise<void>
}

export function useNextVisit(customerId: string): UseNextVisitState {
  const [loading, setLoading] = useState(true)
  const [result, setResult] = useState<NextVisitResult | null>(null)
  const [overrideDate, setOverrideDate] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await authedFetch(`/api/customers/${customerId}/next-visit`)
      if (res.ok) {
        const json = await res.json() as { success: boolean; result?: NextVisitResult; overrideDate?: string | null }
        if (json.success && json.result) {
          setResult(json.result)
          setOverrideDate(json.overrideDate ?? null)
        }
      }
    } catch {
      /* 取得失敗時は前回の表示を維持する(何もしない) */
    } finally {
      setLoading(false)
    }
  }, [customerId])

  useEffect(() => { load() }, [load])

  const setOverride = useCallback(async (date: string | null) => {
    setSaving(true)
    try {
      const res = await authedFetch(`/api/customers/${customerId}/next-visit`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrideDate: date }),
      })
      if (!res.ok) return false
      await load()
      return true
    } catch {
      return false
    } finally {
      setSaving(false)
    }
  }, [customerId, load])

  return { loading, result, overrideDate, saving, setOverride, refetch: load }
}
