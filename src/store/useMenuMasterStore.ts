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

/** Hot Pepper Beauty自動取込機能(2026-09-22)。src/lib/menu/runHotpepperMenuSync.tsの
 *  HotpepperSyncReportをそのままJSON経由で受け取る(APIレスポンスと型を共有)。 */
export interface HotpepperImportReport {
  dryRun: boolean
  fetchedAt: string
  pagesFetched: number
  totalParsedItems: number
  appliedCount: number
  noChangeCount: number
  newItems: { hotpepperItemId: string; name: string; price: number | null; category: 'coupon' | 'menu_option' }[]
  priceChanges: { menuId: string; hotpepperItemId: string; name: string; oldPrice: number; newPrice: number }[]
  backfills: { menuId: string; hotpepperItemId: string; name: string; priceChange: { oldPrice: number; newPrice: number } | null }[]
  possiblyDiscontinued: { menuId: string; name: string; price: number; hotpepperItemId: string }[]
  /** ¥0/価格不明のため新規提案から除外した項目(予約導線案内等、施術実体を持たないもの)。 */
  excludedNoPrice: { hotpepperItemId: string; name: string; price: number | null; category: 'coupon' | 'menu_option' }[]
}

export interface HotpepperImportResult {
  success: boolean
  error?: string
  report?: HotpepperImportReport
}

interface MenuMasterState {
  menus: MenuMasterRow[]
  isLoading: boolean
  error: string | null
  fetchMenus: (storeId: string) => Promise<void>
  createMenu: (storeId: string, input: MenuMutationInput) => Promise<MenuMutationResult>
  updateMenu: (id: string, input: Partial<MenuMutationInput>) => Promise<MenuMutationResult>
  deleteMenu: (id: string) => Promise<MenuMutationResult>
  previewHotpepperImport: (storeId: string) => Promise<HotpepperImportResult>
  applyHotpepperImport: (storeId: string) => Promise<HotpepperImportResult>
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

  previewHotpepperImport: async (storeId) => {
    try {
      const res = await authedFetch('/api/admin/menu/hotpepper-import/preview', {
        method: 'POST',
        body: JSON.stringify({ storeId }),
      })
      const body = await res.json()
      if (!res.ok || !body.success) {
        return { success: false, error: body.error ?? 'hotpepper_preview_failed' }
      }
      return { success: true, report: body.report }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'hotpepper_preview_failed' }
    }
  },

  applyHotpepperImport: async (storeId) => {
    try {
      const res = await authedFetch('/api/admin/menu/hotpepper-import/apply', {
        method: 'POST',
        body: JSON.stringify({ storeId, confirm: true }),
      })
      const body = await res.json()
      if (!res.ok || !body.success) {
        return { success: false, error: body.error ?? 'hotpepper_apply_failed' }
      }
      // 反映後は一覧を最新化する(新規作成・価格更新・バックフィルを画面へ反映するため)。
      await get().fetchMenus(storeId)
      return { success: true, report: body.report }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'hotpepper_apply_failed' }
    }
  },
}))
