/**
 * useProposalFeedbackAnalyticsStore.ts — AI提案分析画面(AI提案学習Phase2/2.5)の状態管理
 *
 * GET /api/admin/proposal-feedback-analyticsで集計結果をfetchするだけ
 * (計算はサーバ側のaggregateProposalFeedback()。ここではUI状態のみ持つ)。
 * Phase2.5: range(30d/90d/all)を指定して取得件数を絞れるようにした。
 */
import { create } from 'zustand'
import { authedFetch } from '@/lib/api/authedFetch'

export type ProposalFeedbackRange = '30d' | '90d' | 'all'

export interface ProposalKindFeedbackRow {
  proposalKind: string
  count: number
  good: number
  bad: number
  goodRate: number
}

export interface PatternFeedbackRow {
  patternId: string
  stepNo: number
  proposalKind: string
  count: number
  good: number
  bad: number
  goodRate: number
}

interface ProposalFeedbackAnalyticsState {
  byKind: ProposalKindFeedbackRow[]
  byPattern: PatternFeedbackRow[]
  range: ProposalFeedbackRange
  /** 取得上限に達し、期間内にさらにデータが存在する可能性がある場合true。 */
  truncated: boolean
  isLoading: boolean
  error: string | null
  fetchAnalytics: (storeId: string, range?: ProposalFeedbackRange) => Promise<void>
}

export const useProposalFeedbackAnalyticsStore = create<ProposalFeedbackAnalyticsState>((set) => ({
  byKind: [],
  byPattern: [],
  range: '30d',
  truncated: false,
  isLoading: false,
  error: null,

  fetchAnalytics: async (storeId: string, range: ProposalFeedbackRange = '30d') => {
    set({ isLoading: true, error: null, range })
    try {
      const qs = new URLSearchParams({ storeId, range })
      const res = await authedFetch(`/api/admin/proposal-feedback-analytics?${qs.toString()}`)
      const body = await res.json()
      if (!res.ok || !body.success) {
        set({ error: body.error ?? 'proposal_feedback_analytics_failed', isLoading: false })
        return
      }
      set({ byKind: body.byKind, byPattern: body.byPattern, truncated: body.truncated ?? false, isLoading: false })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'proposal_feedback_analytics_failed', isLoading: false })
    }
  },
}))
