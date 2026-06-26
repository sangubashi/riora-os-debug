/**
 * useProposalStore.ts — 顧客詳細AI提案パネルの状態管理(AI提案本物化)
 *
 * GET/POST /api/admin/proposals をfetchするだけ(計算・LLM呼び出しは一切ここでは行わない)。
 */
import { create } from 'zustand'

export interface FiredProposalView {
  customerId: string
  candidateCode: string
  patternId: string
  stepNo: number
  proposalKind: string
  baseScript: string
  adjustedScript: string
  scriptStyle: string
  priority: number
  isMandatory: boolean
  fireScore: number
  decisiveFactor: string | null
}

export interface ExplainTextsView {
  staffLine1: string
  staffAvoid: string | null
  managerQ1: string
  managerQ2: string
  managerQ3: string
}

export interface ProposalView {
  inStore: { mandatory: FiredProposalView | null; secondary: FiredProposalView | null; candidateDate: string | null }
  dm: { scenarioId: string; proposalKind: string; status: string } | null
  explanation: ExplainTextsView
  decisionRecordId: string | null
}

export interface VoiceMemoContextView {
  linkStatus: 'matched' | 'no_match' | 'ambiguous_match'
  legacyCustomerId: string | null
  customerNotes: { category: string; note: string; createdAt: string }[]
  contraindications: { severity: string; title: string; description: string | null }[]
  latestBookingPromptSummary: string | null
  latestHandoverSummary: string | null
}

export interface LineHistoryContextView {
  recentCount: number
  items: { scenarioCode: string; approvalStatus: string; createdAt: string }[]
}

export interface ProposalResultView {
  proposal: ProposalView | { degraded: true; reason: string; proposal: ProposalView }
  voiceMemoContext: VoiceMemoContextView
  lineHistoryContext: LineHistoryContextView
}

interface ProposalState {
  result: ProposalResultView | null
  isLoading: boolean
  isSaving: boolean
  error: string | null
  saveSuccess: boolean

  generate: (storeId: string, customerId: string, staffId: string) => Promise<void>
  save: (storeId: string, customerId: string, staffId: string) => Promise<void>
  reset: () => void
}

export const useProposalStore = create<ProposalState>((set) => ({
  result: null,
  isLoading: false,
  isSaving: false,
  error: null,
  saveSuccess: false,

  reset: () => set({ result: null, error: null, saveSuccess: false }),

  generate: async (storeId, customerId, staffId) => {
    set({ isLoading: true, error: null, saveSuccess: false })
    try {
      const qs = new URLSearchParams({ storeId, customerId, staffId })
      const res = await fetch(`/api/admin/proposals?${qs.toString()}`)
      const body = await res.json()
      if (!res.ok || !body.success) {
        set({ error: body.error ?? 'proposal_generation_failed', isLoading: false, result: null })
        return
      }
      set({ result: body, isLoading: false })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'proposal_generation_failed', isLoading: false })
    }
  },

  save: async (storeId, customerId, staffId) => {
    set({ isSaving: true, error: null })
    try {
      const res = await fetch('/api/admin/proposals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ storeId, customerId, staffId }),
      })
      const body = await res.json()
      if (!res.ok || !body.success) {
        set({ error: body.error ?? 'proposal_save_failed', isSaving: false })
        return
      }
      set({ isSaving: false, saveSuccess: true })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'proposal_save_failed', isSaving: false })
    }
  },
}))
