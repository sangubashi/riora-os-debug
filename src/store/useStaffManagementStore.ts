/**
 * useStaffManagementStore.ts — スタッフ管理画面(一覧・退職処理・招待)の状態管理
 * STAFF_MANAGEMENT_PHASE1_IMPLEMENT_1: brain_staffの一覧・退職処理。
 * STAFF_INVITE_IMPLEMENT_1: 招待発行(POST /api/admin/staff/invite、既存API)を追加。
 */
import { create } from 'zustand'
import { authedFetch } from '@/lib/api/authedFetch'
import type { Staff } from '@/types/riora.types'

export interface StaffMutationResult {
  success: boolean
  error?: string
}

export interface InviteResult {
  success: boolean
  inviteUrl?: string
  error?: string
}

interface StaffManagementState {
  staff: Staff[]
  isLoading: boolean
  error: string | null
  fetchStaff: (storeId: string) => Promise<void>
  deactivateStaff: (id: string) => Promise<StaffMutationResult>
  inviteStaff: (input: { staffName: string; email: string }) => Promise<InviteResult>
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

  inviteStaff: async ({ staffName, email }) => {
    try {
      const res = await authedFetch('/api/admin/staff/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staff_name: staffName, email, role: 'staff' }),
      })
      const body = await res.json()

      if (!res.ok || !body.success) {
        return { success: false, error: body.error ?? 'staff_invite_failed' }
      }

      return { success: true, inviteUrl: body.inviteUrl }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'staff_invite_failed' }
    }
  },
}))
