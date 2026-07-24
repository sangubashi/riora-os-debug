/**
 * useBlogArticleStore.ts — ブログ記事管理画面(brain_blog_articles CRUD)の状態管理
 *
 * BLOG_CONTENT_PHASE1。/api/admin/blog-articles をfetchするだけ。
 * 記事本文は一切扱わない(URL登録のみ)。
 */
import { create } from 'zustand'
import { authedFetch } from '@/lib/api/authedFetch'
import type { BlogArticle } from '@/types/riora.types'

export interface BlogArticleMutationInput {
  title: string
  sourceUrl: string
  products: string[]
  keywords: string[]
}

export interface BlogArticleMutationResult {
  success: boolean
  error?: string
}

interface BlogArticleState {
  articles: BlogArticle[]
  isLoading: boolean
  error: string | null
  fetchArticles: () => Promise<void>
  createArticle: (input: BlogArticleMutationInput) => Promise<BlogArticleMutationResult>
  updateArticle: (id: string, input: Partial<BlogArticleMutationInput>) => Promise<BlogArticleMutationResult>
  toggleApproval: (id: string, isCustomerSafe: boolean) => Promise<BlogArticleMutationResult>
  deleteArticle: (id: string) => Promise<BlogArticleMutationResult>
}

export const useBlogArticleStore = create<BlogArticleState>((set, get) => ({
  articles: [],
  isLoading: false,
  error: null,

  fetchArticles: async () => {
    set({ isLoading: true, error: null })
    try {
      const res = await authedFetch('/api/admin/blog-articles')
      const body = await res.json()

      if (!res.ok || !body.success) {
        set({ error: body.error ?? 'blog_articles_fetch_failed', isLoading: false })
        return
      }

      set({ articles: body.articles, isLoading: false })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'blog_articles_fetch_failed', isLoading: false })
    }
  },

  createArticle: async (input) => {
    try {
      const res = await authedFetch('/api/admin/blog-articles', {
        method: 'POST',
        body: JSON.stringify(input),
      })
      const body = await res.json()

      if (!res.ok || !body.success) {
        return { success: false, error: body.error ?? 'blog_article_create_failed' }
      }

      set({ articles: [body.article, ...get().articles] })
      return { success: true }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'blog_article_create_failed' }
    }
  },

  updateArticle: async (id, input) => {
    try {
      const res = await authedFetch(`/api/admin/blog-articles/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      })
      const body = await res.json()

      if (!res.ok || !body.success) {
        return { success: false, error: body.error ?? 'blog_article_update_failed' }
      }

      set({ articles: get().articles.map((a) => (a.id === id ? body.article : a)) })
      return { success: true }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'blog_article_update_failed' }
    }
  },

  toggleApproval: async (id, isCustomerSafe) => {
    try {
      const res = await authedFetch(`/api/admin/blog-articles/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isCustomerSafe }),
      })
      const body = await res.json()

      if (!res.ok || !body.success) {
        return { success: false, error: body.error ?? 'blog_article_update_failed' }
      }

      set({ articles: get().articles.map((a) => (a.id === id ? body.article : a)) })
      return { success: true }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'blog_article_update_failed' }
    }
  },

  deleteArticle: async (id) => {
    try {
      const res = await authedFetch(`/api/admin/blog-articles/${id}`, { method: 'DELETE' })
      const body = await res.json()

      if (!res.ok || !body.success) {
        return { success: false, error: body.error ?? 'blog_article_delete_failed' }
      }

      set({ articles: get().articles.filter((a) => a.id !== id) })
      return { success: true }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : 'blog_article_delete_failed' }
    }
  },
}))
