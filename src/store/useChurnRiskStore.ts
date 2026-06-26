/**
 * useChurnRiskStore.ts — 画面②離脱予兆センター(MD-2)の状態管理
 *
 * 設計根拠: docs/architecture/Riora_Management_Dashboard_Architecture_v2.0.md 画面②
 *
 * GET /api/admin/churn-riskで危険顧客一覧をfetchし、
 * POST /api/admin/churn-risk/instructで「担当スタッフへ指示」を送るだけ。
 * 管理者は閲覧と指示のみ(LINE送信・予約操作はこのストアからは行わない)。
 */
import { create } from 'zustand'

export interface ChurnRiskCustomer {
  customerId: string
  customerName: string
  lastVisitDate: string
  daysSinceLastVisit: number
  avgIntervalDays: number
  churnRiskScore: number
  assignedStaffId: string | null
  assignedStaffName: string | null
}

interface ChurnRiskState {
  dangerCustomers: ChurnRiskCustomer[]
  isLoading: boolean
  error: string | null
  /** 指示送信中のcustomerId(送信中はボタンを無効化するため)。 */
  instructingCustomerId: string | null
  instructError: string | null
  fetchChurnRisk: (storeId: string) => Promise<void>
  instructStaff: (input: { storeId: string; customerId: string; staffId: string; note: string }) => Promise<boolean>
}

export const useChurnRiskStore = create<ChurnRiskState>((set) => ({
  dangerCustomers: [],
  isLoading: false,
  error: null,
  instructingCustomerId: null,
  instructError: null,

  fetchChurnRisk: async (storeId: string) => {
    set({ isLoading: true, error: null })

    try {
      const res = await fetch(`/api/admin/churn-risk?storeId=${encodeURIComponent(storeId)}`)
      const body = await res.json()

      if (!res.ok || !body.success) {
        set({ error: body.error ?? 'churn_risk_fetch_failed', isLoading: false })
        return
      }

      set({ dangerCustomers: body.dangerCustomers, isLoading: false })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'churn_risk_fetch_failed', isLoading: false })
    }
  },

  instructStaff: async ({ storeId, customerId, staffId, note }) => {
    set({ instructingCustomerId: customerId, instructError: null })

    try {
      const res = await fetch('/api/admin/churn-risk/instruct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, customerId, staffId, note }),
      })
      const body = await res.json()

      if (!res.ok || !body.success) {
        set({ instructError: body.error ?? 'instruct_failed', instructingCustomerId: null })
        return false
      }

      set({ instructingCustomerId: null })
      return true
    } catch (e) {
      set({ instructError: e instanceof Error ? e.message : 'instruct_failed', instructingCustomerId: null })
      return false
    }
  },
}))
