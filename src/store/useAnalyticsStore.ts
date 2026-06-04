/**
 * useAnalyticsStore.ts  — 分析データ共有ストア
 *
 * CSV取込後に全分析パネルへデータを供給する。
 * 初期値はダミーデータ。CSV取込で上書きされる。
 */

import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type {
  CustomerAnalyticsResult,
  VipAnalyticsResult,
  TreatmentAnalyticsResult,
  ProductAnalyticsResult,
  StoreLearningResult,
} from '@/types'
import { calcCustomerAnalytics, DEMO_ANALYTICS_CUSTOMERS } from '@/lib/analytics/customerAnalytics'
import { calcVipAnalytics,       DEMO_VIP_ROWS            } from '@/lib/analytics/vipAnalytics'
import { calcTreatmentAnalytics, DEMO_TREATMENT_ROWS      } from '@/lib/analytics/treatmentAnalytics'
import { calcProductAnalytics,   DEMO_PRODUCT_ROWS        } from '@/lib/analytics/productAnalytics'
import { calcStoreLearning                                 } from '@/lib/analytics/storeLearningAnalytics'
import type { AnalyticsCustomerRow } from '@/lib/analytics/customerAnalytics'
import type { VipAnalyticsRow      } from '@/lib/analytics/vipAnalytics'
import type { TreatmentCustomerRow } from '@/lib/analytics/treatmentAnalytics'
import type { ProductCustomerRow   } from '@/lib/analytics/productAnalytics'

// ─── 初期値（ダミーデータで計算） ──────────────────────────────────────────────

function buildInitial() {
  const vip       = calcVipAnalytics(DEMO_VIP_ROWS)
  const treatment = calcTreatmentAnalytics(DEMO_TREATMENT_ROWS)
  const product   = calcProductAnalytics(DEMO_PRODUCT_ROWS)
  const customer  = calcCustomerAnalytics(DEMO_ANALYTICS_CUSTOMERS)
  const learning  = calcStoreLearning(vip, treatment, product)
  return { vip, treatment, product, customer, learning }
}

// ─── Store 型 ─────────────────────────────────────────────────────────────────

interface AnalyticsState {
  customer:   CustomerAnalyticsResult
  vip:        VipAnalyticsResult
  treatment:  TreatmentAnalyticsResult
  product:    ProductAnalyticsResult
  learning:   StoreLearningResult
  refreshKey: number          // bump で全パネルを再レンダリング
  lastUpdated: string | null  // ISO datetime
  isFromCsv:  boolean         // CSV由来データか否か

  /** CSV取込後に全分析を再計算して更新 */
  refreshFromCsv: (
    customers:  AnalyticsCustomerRow[],
    vipRows:    VipAnalyticsRow[],
    treatments: TreatmentCustomerRow[],
    products:   ProductCustomerRow[],
  ) => void
}

// ─── Store 実装 ───────────────────────────────────────────────────────────────

const initial = buildInitial()

export const useAnalyticsStore = create<AnalyticsState>((set) => ({
  ...initial,
  refreshKey:  0,
  lastUpdated: null,
  isFromCsv:   false,

  refreshFromCsv: (customers, vipRows, treatments, products) => {
    const vip       = calcVipAnalytics(vipRows)
    const treatment = calcTreatmentAnalytics(treatments)
    const product   = calcProductAnalytics(products)
    const customer  = calcCustomerAnalytics(customers)
    const learning  = calcStoreLearning(vip, treatment, product)

    set(state => ({
      vip, treatment, product, customer, learning,
      refreshKey:  state.refreshKey + 1,
      lastUpdated: new Date().toISOString(),
      isFromCsv:   true,
    }))
  },
}))

// ─── shallow セレクター（不要な再レンダリングを防ぐ） ──────────────────────────

/** KPIパネル群が使う shallow セレクター */
export function useAnalyticsData() {
  return useAnalyticsStore(
    useShallow(s => ({
      customer:    s.customer,
      vip:         s.vip,
      treatment:   s.treatment,
      product:     s.product,
      learning:    s.learning,
      refreshKey:  s.refreshKey,
      isFromCsv:   s.isFromCsv,
      lastUpdated: s.lastUpdated,
    }))
  )
}
