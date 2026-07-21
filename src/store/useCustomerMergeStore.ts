/**
 * useCustomerMergeStore.ts — 顧客統合(Duplicate Merge Queue)の状態管理
 *
 * 設計根拠: docs/DUPLICATE_MERGE_QUEUE_DESIGN.md
 *
 * GET /api/admin/customer-merge/candidates で候補一覧を取得、
 * GET /api/admin/customer-merge/candidates/[groupKey] でグループ詳細を取得、
 * POST /api/admin/customer-merge/execute で統合実行、
 * POST /api/admin/customer-merge/rollback でrollback実行。
 */
import { create } from 'zustand'
import { authedFetch } from '@/lib/api/authedFetch'
import type { MergeGroupSummary, MergeGroupDetail } from '@/types/customerMerge'

interface CustomerMergeState {
  groups: MergeGroupSummary[]
  isLoading: boolean
  error: string | null

  selectedDetail: MergeGroupDetail | null
  isDetailLoading: boolean
  detailError: string | null

  isExecuting: boolean
  executeError: string | null
  lastExecuteResult: { opsLogId: string; survivorId: string; visitsReassigned: number } | null

  isRollingBack: boolean
  rollbackError: string | null

  fetchGroups: (storeId: string) => Promise<void>
  fetchGroupDetail: (storeId: string, groupKey: string) => Promise<void>
  clearDetail: () => void
  executeMerge: (input: { storeId: string; mergeGroupId: string; survivorId: string; mergedIds: string[] }) => Promise<boolean>
  rollbackMerge: (input: { storeId: string; opsLogId: string }) => Promise<boolean>
}

export const useCustomerMergeStore = create<CustomerMergeState>((set, get) => ({
  groups: [],
  isLoading: false,
  error: null,

  selectedDetail: null,
  isDetailLoading: false,
  detailError: null,

  isExecuting: false,
  executeError: null,
  lastExecuteResult: null,

  isRollingBack: false,
  rollbackError: null,

  fetchGroups: async (storeId: string) => {
    set({ isLoading: true, error: null })
    try {
      const res = await authedFetch(`/api/admin/customer-merge/candidates?storeId=${encodeURIComponent(storeId)}`)
      const body = await res.json()
      if (!res.ok || !body.success) {
        set({ error: body.error ?? 'candidates_fetch_failed', isLoading: false })
        return
      }
      set({ groups: body.groups, isLoading: false })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'candidates_fetch_failed', isLoading: false })
    }
  },

  fetchGroupDetail: async (storeId: string, groupKey: string) => {
    set({ isDetailLoading: true, detailError: null, selectedDetail: null, lastExecuteResult: null, executeError: null, rollbackError: null })
    try {
      const res = await authedFetch(`/api/admin/customer-merge/candidates/${encodeURIComponent(groupKey)}?storeId=${encodeURIComponent(storeId)}`)
      const body = await res.json()
      if (!res.ok || !body.success) {
        set({ detailError: body.error ?? 'detail_fetch_failed', isDetailLoading: false })
        return
      }
      set({ selectedDetail: body.detail, isDetailLoading: false })
    } catch (e) {
      set({ detailError: e instanceof Error ? e.message : 'detail_fetch_failed', isDetailLoading: false })
    }
  },

  clearDetail: () => set({ selectedDetail: null, detailError: null, lastExecuteResult: null, executeError: null, rollbackError: null }),

  executeMerge: async ({ storeId, mergeGroupId, survivorId, mergedIds }) => {
    set({ isExecuting: true, executeError: null })
    try {
      const res = await authedFetch('/api/admin/customer-merge/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, mergeGroupId, survivorId, mergedIds }),
      })
      const body = await res.json()
      if (!res.ok || !body.success) {
        set({ executeError: body.error ?? 'execute_failed', isExecuting: false })
        return false
      }
      set({
        isExecuting: false,
        lastExecuteResult: { opsLogId: body.opsLogId, survivorId: body.survivorId, visitsReassigned: body.visitsReassigned },
        groups: get().groups.filter((g) => g.groupKey !== get().selectedDetail?.groupKey),
        // selectedDetail はここでクリアしない: 完了画面(氏名・opsLogId表示+rollback導線)が
        // 参照し続けるため、モーダルを閉じるタイミング(clearDetail)まで保持する。
      })
      return true
    } catch (e) {
      set({ executeError: e instanceof Error ? e.message : 'execute_failed', isExecuting: false })
      return false
    }
  },

  rollbackMerge: async ({ storeId, opsLogId }) => {
    set({ isRollingBack: true, rollbackError: null })
    try {
      const res = await authedFetch('/api/admin/customer-merge/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, opsLogId }),
      })
      const body = await res.json()
      if (!res.ok || !body.success) {
        set({ rollbackError: body.error ?? 'rollback_failed', isRollingBack: false })
        return false
      }
      set({ isRollingBack: false })
      return true
    } catch (e) {
      set({ rollbackError: e instanceof Error ? e.message : 'rollback_failed', isRollingBack: false })
      return false
    }
  },
}))
