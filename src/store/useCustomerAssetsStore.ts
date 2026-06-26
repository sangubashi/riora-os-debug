/**
 * useCustomerAssetsStore.ts — 画面③顧客管理(MD-3)の状態管理
 *
 * GET /api/admin/customer-assetsをfetchするだけ(集計はAPI側で完了済み)。
 * 管理者は閲覧のみ(顧客編集・削除のアクションはこのストアに持たせない)。
 */
import { create } from 'zustand'

export interface CustomerAssetRow {
  customerId: string
  customerName: string
  visitCount: number
  lastVisitDate: string | null
  totalSales: number
  ltv: number
  nominationRate: number | null
  avgIntervalDays: number | null
}

interface CustomerAssetsState {
  customerAssets: CustomerAssetRow[]
  isLoading: boolean
  error: string | null
  fetchCustomerAssets: (storeId: string) => Promise<void>
}

export const useCustomerAssetsStore = create<CustomerAssetsState>((set) => ({
  customerAssets: [],
  isLoading: false,
  error: null,

  fetchCustomerAssets: async (storeId: string) => {
    set({ isLoading: true, error: null })

    try {
      const res = await fetch(`/api/admin/customer-assets?storeId=${encodeURIComponent(storeId)}`)
      const body = await res.json()

      if (!res.ok || !body.success) {
        set({ error: body.error ?? 'customer_assets_fetch_failed', isLoading: false })
        return
      }

      set({ customerAssets: body.customerAssets, isLoading: false })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'customer_assets_fetch_failed', isLoading: false })
    }
  },
}))
