/**
 * useStaffManagementStore.ts — スタッフ管理画面(一覧・退職処理)の状態管理
 * STAFF_MANAGEMENT_PHASE1_IMPLEMENT_1: brain_staffのみ利用。招待機能(Phase2)は対象外。
 */
import { create } from 'zustand'
import { authedFetch } from '@/lib/api/authedFetch'
import type { Staff } from '@/types/riora.types'

export interface StaffMutationResult {
  success: boolean
  error?: string
}

interface StaffManagementState {
  staff: Staff[]
  isLoading: boolean
  error: string | null
  fetchStaff: (storeId: string) => Promise<void>
  deactivateStaff: (id: string) => Promise<StaffMutationResult>
}

export const useStaffManagementStore = create<StaffManagementState>((set, get) => ({
  staff: [],
  isLoading: false,
  error: null,

  fetchStaff: async (storeId: string) => {
    set({ isLoading: true, error: null })

    try {
      const res = await authedFetch(`/api/admin/staff?storeId=${encodeURIComponent(storeId)}`)
      const body = await res.json()

      if (!res.ok || !body.success) {
        set({ error: body.error ?? 'staff_fetch_failed', isLoading: false })
        return
      }

      set({ staff: body.staff, isLoading: false })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'staff_fetch_failed', isLoading: false })
    }
  },

  deactivateStaff: async (id: string) => {
    try {
      const res = await authedFetch(`/api/admin/staff/${id}`, { method: 'PATCH' })
      const body = await res.json()

      if (!res.ok || !body.success) {
        return { success: false, error: body.error ?? 'staff_deactivate_failed' }
      }

      set({ staff: get().staff.map((s) => (s.id === id ? body.staff : s)) })
      return { success: true }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'staff_deactivate_failed' }
    }
  },
}))
