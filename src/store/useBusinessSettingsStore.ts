/**
 * useBusinessSettingsStore.ts — 固定費・変動費率設定画面の状態管理
 *
 * 設計根拠: docs/architecture/Riora_損益分岐・コスト構造_設計書_v1.0.md §4
 *
 * GET/POST /api/admin/business-settings をfetchするだけ(計算はDashboardAggregator側)。
 * mock禁止のためSupabase直叩き・ハードコード値は持たない。
 */
import { create } from 'zustand'

export interface BusinessSettingsData {
  storeId: string
  month: string
  salesTarget: number
  fixedCosts: Record<string, unknown> | null
  variableCostRate: number
  variableRates: Record<string, unknown> | null
}

export type CostBreakdown = Record<string, number | null>

interface BusinessSettingsState {
  settings: BusinessSettingsData | null
  isLoading: boolean
  isSaving: boolean
  error: string | null
  saveError: string | null
  saveSuccess: boolean

  fetchSettings: (storeId: string, month?: string) => Promise<void>
  saveSettings: (input: {
    storeId: string
    month: string
    salesTarget?: number
    fixedCosts?: CostBreakdown
    variableCostRate?: number
    variableRates?: CostBreakdown
  }) => Promise<boolean>
}

export const useBusinessSettingsStore = create<BusinessSettingsState>((set) => ({
  settings: null,
  isLoading: false,
  isSaving: false,
  error: null,
  saveError: null,
  saveSuccess: false,

  fetchSettings: async (storeId, month) => {
    set({ isLoading: true, error: null })
    try {
      const qs = new URLSearchParams({ storeId, ...(month ? { month } : {}) })
      const res = await fetch(`/api/admin/business-settings?${qs.toString()}`)
      const body = await res.json()

      if (!res.ok || !body.success) {
        set({ error: body.error ?? 'business_settings_fetch_failed', isLoading: false })
        return
      }
      set({ settings: body.settings, isLoading: false })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'business_settings_fetch_failed', isLoading: false })
    }
  },

  saveSettings: async (input) => {
    set({ isSaving: true, saveError: null, saveSuccess: false })
    try {
      const res = await fetch('/api/admin/business-settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      const body = await res.json()

      if (!res.ok || !body.success) {
        set({ saveError: body.error ?? 'business_settings_save_failed', isSaving: false })
        return false
      }
      set({ settings: body.settings, isSaving: false, saveSuccess: true })
      return true
    } catch (e) {
      set({ saveError: e instanceof Error ? e.message : 'business_settings_save_failed', isSaving: false })
      return false
    }
  },
}))
