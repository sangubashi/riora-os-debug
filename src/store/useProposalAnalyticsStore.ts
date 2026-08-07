/**
 * useProposalAnalyticsStore.ts — AI提案分析画面(AI提案分析MVP)の状態管理
 *
 * GET /api/admin/proposal-analyticsで集計結果をfetchするだけ
 * (計算はサーバ側のaggregateProposalAnalytics()。ここではUI状態のみ持つ)。
 * 既存のuseProposalFeedbackAnalyticsStore(👍👎集計)とは独立したstore
 * (画面は同じ`/admin/proposal-feedback`内で両方使う)。
 */
import { create } from 'zustand'
import { authedFetch } from '@/lib/api/authedFetch'
import type {
  ProposalAnalyticsMonthlyPoint,
  ProposalAnalyticsPatternRow,
  ProposalAnalyticsSummary,
} from '@/lib/proposalAnalytics/aggregateProposalAnalytics'

export type ProposalAnalyticsRange = '30d' | '90d' | 'all'

interface ProposalAnalyticsState {
  summary: ProposalAnalyticsSummary | null
  monthlyTrend: ProposalAnalyticsMonthlyPoint[]
  patternSuccessRate: ProposalAnalyticsPatternRow[]
  range: ProposalAnalyticsRange
  /** 取得上限に達し、期間内にさらにデータが存在する可能性がある場合true。 */
  truncated: boolean
  isLoading: boolean
  error: string | null
  fetchProposalAnalytics: (storeId: string, range?: ProposalAnalyticsRange) => Promise<void>
}

export const useProposalAnalyticsStore = create<ProposalAnalyticsState>((set) => ({
  summary: null,
  monthlyTrend: [],
  patternSuccessRate: [],
  range: '30d',
  truncated: false,
  isLoading: false,
  error: null,

  fetchProposalAnalytics: async (storeId: string, range: ProposalAnalyticsRange = '30d') => {
    set({ isLoading: true, error: null, range })
    try {
      const qs = new URLSearchParams({ storeId, range })
      const res = await authedFetch(`/api/admin/proposal-analytics?${qs.toString()}`)
      const body = await res.json()
      if (!res.ok || !body.success) {
        set({ error: body.error ?? 'proposal_analytics_failed', isLoading: false })
        return
      }
      set({
        summary: body.summary,
        monthlyTrend: body.monthlyTrend,
        patternSuccessRate: body.patternSuccessRate,
        truncated: body.truncated ?? false,
        isLoading: false,
      })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'proposal_analytics_failed', isLoading: false })
    }
  },
}))
