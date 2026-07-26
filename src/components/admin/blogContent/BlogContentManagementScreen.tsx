'use client'
/**
 * BlogContentManagementScreen.tsx — ブログ記事管理画面(brain_blog_articles CRUD・管理者専用)
 * BLOG_CONTENT_PHASE1_IMPLEMENT_1
 *
 * スコープ: Phase1-A(テーブル)+Phase1-B(この管理画面)のみ。
 * 記事本文の取得・保存は行わない(URL登録のみ・スクレイピング禁止)。
 * 薬機法チェック・AI判定ロジックは一切実装しない(承認は管理者の手動ON/OFFのみ)。
 * 顧客表示・AI提案への接続(Phase2/Phase3)はこの画面のスコープ外(実装しない)。
 */
import { useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Trash2, ExternalLink, Search } from 'lucide-react'
import { useBlogArticleStore, type BlogArticleMutationInput } from '@/store/useBlogArticleStore'
import type { BlogArticle } from '@/types/riora.types'

type ApprovalFilter = 'all' | 'approved' | 'draft'

const EMPTY_FORM: BlogArticleMutationInput = { title: '', sourceUrl: '', products: [], keywords: [] }

// ─── タグ入力(商品タグ・キーワード共通) ─────────────────────────────────────────

function TagInput({ label, values, onChange }: { label: string; values: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('')

  const addTag = () => {
    const v = draft.trim()
    if (!v || values.includes(v)) { setDraft(''); return }
    onChange([...values, v])
    setDraft('')
  }
  const removeTag = (v: string) => onChange(values.filter((x) => x !== v))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <span style={{ fontSize: '12px', color: '#9F7E6C' }}>{label}</span>
      <div style={{ display: 'flex', gap: '6px' }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
          placeholder="入力してEnterまたは追加"
          style={{ flex: 1, border: '1px solid #F5EEF0', borderRadius: '10px', padding: '8px 10px', fontSize: '13px' }}
        />
        <button
          type="button"
          onClick={addTag}
          style={{ fontSize: '12px', fontWeight: 600, padding: '8px 12px', borderRadius: '10px', border: '1px solid #F5EEF0', background: '#fff', color: '#9F7E6C', cursor: 'pointer' }}
        >
          追加
        </button>
      </div>
      {values.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {values.map((v) => (
            <span
              key={v}
              onClick={() => removeTag(v)}
              title="クリックで削除"
              style={{ fontSize: '11px', padding: '4px 9px', borderRadius: '999px', background: '#FDEEF1', color: '#D98292', cursor: 'pointer' }}
            >
              {v} ×
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── 新規登録フォーム ────────────────────────────────────────────────────────

interface ArticleFormModalProps {
  onCancel: () => void
  onSubmit: (input: BlogArticleMutationInput) => Promise<{ success: boolean; error?: string }>
}

function ArticleFormModal({ onCancel, onSubmit }: ArticleFormModalProps) {
  const [form, setForm] = useState<BlogArticleMutationInput>(EMPTY_FORM)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!form.title.trim()) { setError('タイトルを入力してください'); return }
    if (!form.sourceUrl.trim()) { setError('URLを入力してください'); return }
    setIsSubmitting(true)
    setError(null)
    const result = await onSubmit(form)
    setIsSubmitting(false)
    if (!result.success) {
      setError(result.error ?? '保存に失敗しました')
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(92,64,51,0.35)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div style={{ background: '#fff', borderRadius: '16px', padding: '20px', width: '100%', maxWidth: '440px', display: 'flex', flexDirection: 'column', gap: '14px', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#5C4033' }}>新規記事登録</h2>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '12px', color: '#9F7E6C' }}>タイトル</span>
          <input
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            style={{ border: '1px solid #F5EEF0', borderRadius: '10px', padding: '8px 10px', fontSize: '14px' }}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '12px', color: '#9F7E6C' }}>URL</span>
          <input
            value={form.sourceUrl}
            onChange={(e) => setForm((f) => ({ ...f, sourceUrl: e.target.value }))}
            placeholder="https://..."
            style={{ border: '1px solid #F5EEF0', borderRadius: '10px', padding: '8px 10px', fontSize: '14px' }}
          />
          <span style={{ fontSize: '11px', color: '#C8A8B0' }}>記事本文は取得・保存しません（URLの登録のみ）</span>
        </label>

        <TagInput label="商品タグ" values={form.products} onChange={(v) => setForm((f) => ({ ...f, products: v }))} />
        <TagInput label="キーワード" values={form.keywords} onChange={(v) => setForm((f) => ({ ...f, keywords: v }))} />

        {error && <p style={{ fontSize: '12px', color: '#D14F4F' }}>{error}</p>}

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' }}>
          <button
            onClick={onCancel}
            disabled={isSubmitting}
            style={{ fontSize: '13px', fontWeight: 600, padding: '9px 16px', borderRadius: '10px', border: '1px solid #F5EEF0', background: '#fff', color: '#9F7E6C', cursor: 'pointer' }}
          >
            キャンセル
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            style={{ fontSize: '13px', fontWeight: 700, padding: '9px 16px', borderRadius: '10px', border: 'none', background: '#D98292', color: '#fff', cursor: 'pointer' }}
          >
            {isSubmitting ? '保存中...' : '登録する'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── 記事1行 ─────────────────────────────────────────────────────────────────

function ArticleRow({ article }: { article: BlogArticle }) {
  const { toggleApproval, deleteArticle } = useBlogArticleStore()
  const [confirming, setConfirming] = useState(false)
  const [isToggling, setIsToggling] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [rowError, setRowError] = useState<string | null>(null)

  const isApproved = article.status === 'approved'

  const handleToggle = async () => {
    setIsToggling(true)
    setRowError(null)
    const result = await toggleApproval(article.id, !article.isCustomerSafe)
    setIsToggling(false)
    if (!result.success) setRowError(result.error ?? '更新に失敗しました')
  }

  const handleDelete = async () => {
    setIsDeleting(true)
    setRowError(null)
    const result = await deleteArticle(article.id)
    setIsDeleting(false)
    if (!result.success) {
      setRowError(result.error ?? '削除に失敗しました')
      setConfirming(false)
      return
    }
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #F5EEF0', borderRadius: '16px', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
            <span
              style={{
                fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px', flexShrink: 0,
                background: isApproved ? 'rgba(52,160,112,0.12)' : 'rgba(200,168,176,0.15)',
                color: isApproved ? '#34A070' : '#9F7E6C',
              }}
            >
              {isApproved ? 'Approved' : 'Draft'}
            </span>
            <p style={{ fontSize: '14px', fontWeight: 700, color: '#5C4033', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {article.title}
            </p>
          </div>
          <a
            href={article.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: '11px', color: '#78A8D8', display: 'flex', alignItems: 'center', gap: '3px', wordBreak: 'break-all' }}
          >
            <ExternalLink size={11} style={{ flexShrink: 0 }} />
            {article.sourceUrl}
          </a>
        </div>
        <button
          onClick={() => setConfirming(true)}
          aria-label="削除"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#D14F4F', display: 'flex', flexShrink: 0 }}
        >
          <Trash2 size={16} />
        </button>
      </div>

      {(article.products.length > 0 || article.keywords.length > 0) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {article.products.map((p) => (
            <span key={`p-${p}`} style={{ fontSize: '10px', padding: '3px 8px', borderRadius: '999px', background: '#FDEEF1', color: '#D98292' }}>
              {p}
            </span>
          ))}
          {article.keywords.map((k) => (
            <span key={`k-${k}`} style={{ fontSize: '10px', padding: '3px 8px', borderRadius: '999px', background: '#F0F5FA', color: '#4878A8' }}>
              #{k}
            </span>
          ))}
        </div>
      )}

      <button
        onClick={handleToggle}
        disabled={isToggling}
        style={{
          alignSelf: 'flex-start',
          fontSize: '12px', fontWeight: 700, padding: '6px 14px', borderRadius: '999px', border: 'none', cursor: 'pointer',
          background: isApproved ? 'rgba(52,160,112,0.12)' : '#D98292',
          color: isApproved ? '#34A070' : '#fff',
        }}
      >
        {isToggling ? '更新中...' : isApproved ? '✓ 承認済み（クリックで解除）' : '承認する'}
      </button>

      {confirming && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#FFF8F7', borderRadius: '10px', padding: '8px 10px' }}>
          <span style={{ fontSize: '12px', color: '#5C4033', flex: 1 }}>この記事を削除しますか?（元に戻せません）</span>
          <button
            onClick={handleDelete}
            disabled={isDeleting}
            style={{ fontSize: '12px', fontWeight: 700, padding: '6px 12px', borderRadius: '8px', border: 'none', background: '#D14F4F', color: '#fff', cursor: 'pointer' }}
          >
            {isDeleting ? '削除中...' : '削除する'}
          </button>
          <button
            onClick={() => setConfirming(false)}
            disabled={isDeleting}
            style={{ fontSize: '12px', fontWeight: 600, padding: '6px 12px', borderRadius: '8px', border: '1px solid #F5EEF0', background: '#fff', color: '#9F7E6C', cursor: 'pointer' }}
          >
            キャンセル
          </button>
        </div>
      )}

      {rowError && <p style={{ fontSize: '12px', color: '#D14F4F' }}>{rowError}</p>}
    </div>
  )
}

// ─── メイン画面 ──────────────────────────────────────────────────────────────

export default function BlogContentManagementScreen() {
  const { articles, isLoading, error, fetchArticles, createArticle } = useBlogArticleStore()
  const [modalOpen, setModalOpen] = useState(false)
  const [titleQuery, setTitleQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [approvalFilter, setApprovalFilter] = useState<ApprovalFilter>('all')

  useEffect(() => {
    fetchArticles()
  }, [fetchArticles])

  const categoryOptions = useMemo(
    () => Array.from(new Set(articles.map((a) => a.category).filter((c): c is string => !!c))).sort(),
    [articles]
  )

  const filteredArticles = useMemo(() => {
    const q = titleQuery.trim().toLowerCase()
    return articles.filter((a) => {
      if (q && !a.title.toLowerCase().includes(q)) return false
      if (categoryFilter !== 'all' && a.category !== categoryFilter) return false
      if (approvalFilter !== 'all' && a.status !== approvalFilter) return false
      return true
    })
  }, [articles, titleQuery, categoryFilter, approvalFilter])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '16px', maxWidth: '480px' }}>
      <div>
        <p style={{ fontSize: '10px', fontWeight: 700, color: '#C8A8B0', letterSpacing: '0.1em', marginBottom: '2px' }}>
          BLOG CONTENT
        </p>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          <h1 style={{ fontSize: '18px', fontWeight: 700, color: '#5C4033' }}>ブログ記事管理</h1>
          <button
            onClick={() => setModalOpen(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', fontWeight: 700, padding: '8px 14px', borderRadius: '10px', border: 'none', background: '#D98292', color: '#fff', cursor: 'pointer' }}
          >
            <Plus size={14} /> 新規登録
          </button>
        </div>
        <p style={{ fontSize: '12px', color: '#9F7E6C', marginTop: '4px' }}>
          記事のURLを登録するだけです（本文は取得・保存しません）。承認するまで顧客向けには使われません。
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: '8px', background: '#fff',
            border: '1px solid #F5EEF0', borderRadius: '10px', padding: '8px 10px',
          }}
        >
          <Search size={14} style={{ color: '#C8A8B0', flexShrink: 0 }} />
          <input
            value={titleQuery}
            onChange={(e) => setTitleQuery(e.target.value)}
            placeholder="タイトルで検索"
            style={{ flex: 1, border: 'none', outline: 'none', fontSize: '13px', color: '#5C4033', background: 'transparent' }}
          />
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            style={{ fontSize: '12px', padding: '7px 10px', borderRadius: '10px', border: '1px solid #F5EEF0', background: '#fff', color: '#5C4033' }}
          >
            <option value="all">カテゴリ: すべて</option>
            {categoryOptions.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <select
            value={approvalFilter}
            onChange={(e) => setApprovalFilter(e.target.value as ApprovalFilter)}
            style={{ fontSize: '12px', padding: '7px 10px', borderRadius: '10px', border: '1px solid #F5EEF0', background: '#fff', color: '#5C4033' }}
          >
            <option value="all">承認状態: すべて</option>
            <option value="approved">承認済みのみ</option>
            <option value="draft">未承認のみ</option>
          </select>
        </div>

        {!isLoading && !error && (
          <p style={{ fontSize: '11px', color: '#C8A8B0' }}>{filteredArticles.length}件 / 全{articles.length}件</p>
        )}
      </div>

      {isLoading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 0', color: '#C8A8B0' }}>
          <Loader2 size={18} className="animate-spin" style={{ marginRight: '8px' }} />
          読み込み中...
        </div>
      )}

      {!isLoading && error && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '16px', background: '#FFF0F2', borderRadius: '14px' }}>
          <p style={{ fontSize: '13px', color: '#D14F4F' }}>通信エラーが発生しました</p>
          <button
            onClick={() => fetchArticles()}
            style={{ fontSize: '12px', fontWeight: 700, padding: '6px 14px', borderRadius: '999px', border: 'none', background: '#D98292', color: '#fff', cursor: 'pointer', flexShrink: 0 }}
          >
            再読み込み
          </button>
        </div>
      )}

      {!isLoading && !error && articles.length === 0 && (
        <div style={{ padding: '40px 0', textAlign: 'center', color: '#C8A8B0', fontSize: '13px' }}>
          記事が登録されていません
        </div>
      )}

      {!isLoading && !error && articles.length > 0 && filteredArticles.length === 0 && (
        <div style={{ padding: '40px 0', textAlign: 'center', color: '#C8A8B0', fontSize: '13px' }}>
          条件に一致する記事がありません
        </div>
      )}

      {!isLoading && !error && filteredArticles.map((article) => (
        <ArticleRow key={article.id} article={article} />
      ))}

      {modalOpen && (
        <ArticleFormModal
          onCancel={() => setModalOpen(false)}
          onSubmit={async (input) => {
            const result = await createArticle(input)
            if (result.success) setModalOpen(false)
            return result
          }}
        />
      )}
    </div>
  )
}
