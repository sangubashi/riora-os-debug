/**
 * useMenuMasterStore.ts — メニューマスタ管理画面(brain_menus CRUD)の状態管理
 *
 * 設計根拠: docs/MENU_MASTER_IMPLEMENTATION_PLAN.md / docs/MENU_MASTER_IMPLEMENTATION_REVIEW.md
 * MD-5稼働率分析とは無関係(接続しない)。/api/admin/menu-master をfetchするだけ。
 */
import { create } from 'zustand'
import { authedFetch } from '@/lib/api/authedFetch'
import type { Menu, MenuRole, CustomerType } from '@/types/riora.types'

/** メニューマスタ管理画面の1行。src/types/riora.types.tsのMenu型をそのまま用いる。 */
export type MenuMasterRow = Menu

export interface MenuMutationInput {
  name: string
  price: number
  role: Exclude<MenuRole, 'imported_other'>
  targetTypes: CustomerType[]
}

export interface MenuMutationResult {
  success: boolean
  error?: string
  usageCount?: number
}

interface MenuMasterState {
  menus: MenuMasterRow[]
  isLoading: boolean
  error: string | null
  fetchMenus: (storeId: string) => Promise<void>
  createMenu: (storeId: string, input: MenuMutationInput) => Promise<MenuMutationResult>
  updateMenu: (id: string, input: Partial<MenuMutationInput>) => Promise<MenuMutationResult>
  deleteMenu: (id: string) => Promise<MenuMutationResult>
}

export const useMenuMasterStore = create<MenuMasterState>((set, get) => ({
  menus: [],
  isLoading: false,
  error: null,

  fetchMenus: async (storeId: string) => {
    set({ isLoading: true, error: null })

    try {
      const res = await authedFetch(`/api/admin/menu-master?storeId=${encodeURIComponent(storeId)}`)
      const body = await res.json()

      if (!res.ok || !body.success) {
        set({ error: body.error ?? 'menu_master_fetch_failed', isLoading: false })
        return
      }

      set({ menus: body.menus, isLoading: false })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'menu_master_fetch_failed', isLoading: false })
    }
  },

  createMenu: async (storeId, input) => {
    try {
      const res = await authedFetch('/api/admin/menu-master', {
        method: 'POST',
        body: JSON.stringify({ storeId, ...input }),
      })
      const body = await res.json()

      if (!res.ok || !body.success) {
        return { success: false, error: body.error ?? 'menu_create_failed' }
      }

      set({ menus: [...get().menus, body.menu] })
      return { success: true }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'menu_create_failed' }
    }
  },

  updateMenu: async (id, input) => {
    try {
      const res = await authedFetch(`/api/admin/menu-master/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      })
      const body = await res.json()

      if (!res.ok || !body.success) {
        return { success: false, error: body.error ?? 'menu_update_failed' }
      }

      set({ menus: get().menus.map((m) => (m.id === id ? body.menu : m)) })
      return { success: true }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'menu_update_failed' }
    }
  },

  deleteMenu: async (id) => {
    try {
      const res = await authedFetch(`/api/admin/menu-master/${id}`, { method: 'DELETE' })
      const body = await res.json()

      if (!res.ok || !body.success) {
        return { success: false, error: body.error ?? 'menu_delete_failed', usageCount: body.usageCount }
      }

      set({ menus: get().menus.filter((m) => m.id !== id) })
      return { success: true }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'menu_delete_failed' }
    }
  },
}))
