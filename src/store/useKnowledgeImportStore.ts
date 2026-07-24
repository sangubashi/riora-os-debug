/**
 * useKnowledgeImportStore.ts — ナレッジ取込画面(/admin/knowledge-import)の状態管理
 *
 * KNOWLEDGE_IMPORT_PHASE1。CSVアップロード→プレビュー→確定登録→一覧/編集/削除のみ。
 * LLM・外部API連携は一切行わない(CSVの内容をそのまま保存するだけ)。
 */
import { create } from 'zustand'
import { authedFetch } from '@/lib/api/authedFetch'
import type { BlogArticle } from '@/types/riora.types'

export interface KnowledgeImportRow {
  title: string
  sourceUrl: string
  category: string | null
  keywords: string[]
  summary: string
  publishedAt: string | null
}

export interface KnowledgeImportSkippedRow {
  lineNumber: number
  reason: string
  raw: Record<string, string>
}

export interface KnowledgeImportUpdateInput {
  title?: string
  sourceUrl?: string
  category?: string | null
  keywords?: string[]
  summary?: string
  publishedAt?: string | null
}

export interface KnowledgeImportMutationResult {
  success: boolean
  error?: string
}

interface KnowledgeImportState {
  articles: BlogArticle[]
  isLoading: boolean
  error: string | null

  previewRows: KnowledgeImportRow[]
  skippedRows: KnowledgeImportSkippedRow[]
  isPreviewing: boolean
  previewError: string | null

  isImporting: boolean
  importError: string | null

  fetchArticles: () => Promise<void>
  previewCsv: (csvText: string) => Promise<void>
  clearPreview: () => void
  commitImport: () => Promise<{ success: boolean; imported: number; failed: number; error?: string }>
  updateArticle: (id: string, input: KnowledgeImportUpdateInput) => Promise<KnowledgeImportMutationResult>
  deleteArticle: (id: string) => Promise<KnowledgeImportMutationResult>
}

export const useKnowledgeImportStore = create<KnowledgeImportState>((set, get) => ({
  articles: [],
  isLoading: false,
  error: null,

  previewRows: [],
  skippedRows: [],
  isPreviewing: false,
  previewError: null,

  isImporting: false,
  importError: null,

  fetchArticles: async () => {
    set({ isLoading: true, error: null })
    try {
      const res = await authedFetch('/api/admin/knowledge-import')
      const body = await res.json()
      if (!res.ok || !body.success) {
        set({ error: body.error ?? 'knowledge_import_fetch_failed', isLoading: false })
        return
      }
      set({ articles: body.articles, isLoading: false })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'knowledge_import_fetch_failed', isLoading: false })
    }
  },

  previewCsv: async (csvText) => {
    set({ isPreviewing: true, previewError: null, previewRows: [], skippedRows: [] })
    try {
      const res = await authedFetch('/api/admin/knowledge-import/preview', {
        method: 'POST',
        body: JSON.stringify({ csvText }),
      })
      const body = await res.json()
      if (!res.ok || !body.success) {
        set({ previewError: body.error ?? 'knowledge_import_preview_failed', isPreviewing: false })
        return
      }
      set({ previewRows: body.validRows, skippedRows: body.skippedRows, isPreviewing: false })
    } catch (e) {
      set({ previewError: e instanceof Error ? e.message : 'knowledge_import_preview_failed', isPreviewing: false })
    }
  },

  clearPreview: () => set({ previewRows: [], skippedRows: [], previewError: null }),

  commitImport: async () => {
    const { previewRows } = get()
    if (previewRows.length === 0) {
      return { success: false, imported: 0, failed: 0, error: '取込可能な行がありません' }
    }
    set({ isImporting: true, importError: null })
    try {
      const res = await authedFetch('/api/admin/knowledge-import/commit', {
        method: 'POST',
        body: JSON.stringify({ rows: previewRows }),
      })
      const body = await res.json()
      if (!res.ok || !body.success) {
        set({ isImporting: false, importError: body.error ?? 'knowledge_import_commit_failed' })
        return { success: false, imported: 0, failed: 0, error: body.error ?? 'knowledge_import_commit_failed' }
      }
      set({
        isImporting: false,
        articles: [...body.imported, ...get().articles],
        previewRows: [],
        skippedRows: [],
      })
      return { success: true, imported: body.imported.length, failed: body.failed.length }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'knowledge_import_commit_failed'
      set({ isImporting: false, importError: msg })
      return { success: false, imported: 0, failed: 0, error: msg }
    }
  },

  updateArticle: async (id, input) => {
    try {
      const res = await authedFetch(`/api/admin/knowledge-import/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      })
      const body = await res.json()
      if (!res.ok || !body.success) {
        return { success: false, error: body.error ?? 'knowledge_import_update_failed' }
      }
      set({ articles: get().articles.map((a) => (a.id === id ? body.article : a)) })
      return { success: true }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'knowledge_import_update_failed' }
    }
  },

  deleteArticle: async (id) => {
    try {
      const res = await authedFetch(`/api/admin/knowledge-import/${id}`, { method: 'DELETE' })
      const body = await res.json()
      if (!res.ok || !body.success) {
        return { success: false, error: body.error ?? 'knowledge_import_delete_failed' }
      }
      set({ articles: get().articles.filter((a) => a.id !== id) })
      return { success: true }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'knowledge_import_delete_failed' }
    }
  },
}))
