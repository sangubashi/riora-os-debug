'use client'
/**
 * KnowledgeImportScreen.tsx — ナレッジ取込画面(brain_blog_articles CSV取込・管理者専用)
 * KNOWLEDGE_IMPORT_PHASE1_IMPLEMENT_1
 *
 * スコープ: CSVアップロード・プレビュー・取込・一覧・編集・削除のみ。
 * LLM・外部API連携は一切行わない(CSVの内容をそのまま保存する)。
 * AI提案接続・関連記事表示・CustomerBottomSheet・ホームケア・音声メモ・
 * brain_care_knowledgeはこの画面のスコープ外(実装しない)。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Upload, Trash2, ExternalLink, Pencil, Search } from 'lucide-react'
import {
  useKnowledgeImportStore,
  type KnowledgeImportUpdateInput,
} from '@/store/useKnowledgeImportStore'
import type { BlogArticle } from '@/types/riora.types'

const CSV_SAMPLE = 'title,url,category,keywords,summary,published_date\n' +
  '例: 毛穴ケアの基本,https://example.com/article1,毛穴ケア,"毛穴,皮脂,黒ずみ",要約文をここに記入,2026-01-15'

// ─── 編集モーダル ────────────────────────────────────────────────────────────

interface EditModalProps {
  article: BlogArticle
  onCancel: () => void
  onSubmit: (input: KnowledgeImportUpdateInput) => Promise<{ success: boolean; error?: string }>
}

function EditModal({ article, onCancel, onSubmit }: EditModalProps) {
  const [title, setTitle] = useState(article.title)
  const [sourceUrl, setSourceUrl] = useState(article.sourceUrl)
  const [category, setCategory] = useState(article.category ?? '')
  const [keywordsText, setKeywordsText] = useState(article.keywords.join(', '))
  const [summary, setSummary] = useState(article.summary ?? '')
  const [publishedDate, setPublishedDate] = useState(article.publishedAt ?? '')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!title.trim()) { setError('タイトルを入力してください'); return }
    if (!sourceUrl.trim()) { setError('URLを入力してください'); return }
    if (!summary.trim()) { setError('要約を入力してください'); return }
    setIsSubmitting(true)
    setError(null)
    const result = await onSubmit({
      title: title.trim(),
      sourceUrl: sourceUrl.trim(),
      category: category.trim() || null,
      keywords: keywordsText.split(',').map((k) => k.trim()).filter(Boolean),
      summary: summary.trim(),
      publishedAt: publishedDate.trim() || null,
    })
    setIsSubmitting(false)
    if (!result.success) setError(result.error ?? '保存に失敗しました')
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(92,64,51,0.35)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div style={{ background: '#fff', borderRadius: '16px', padding: '20px', width: '100%', maxWidth: '440px', display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#5C4033' }}>記事を編集</h2>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '12px', color: '#9F7E6C' }}>タイトル</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '12px', color: '#9F7E6C' }}>URL</span>
          <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} style={inputStyle} />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '12px', color: '#9F7E6C' }}>カテゴリ</span>
          <input value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle} />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '12px', color: '#9F7E6C' }}>キーワード（カンマ区切り）</span>
          <input value={keywordsText} onChange={(e) => setKeywordsText(e.target.value)} style={inputStyle} />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '12px', color: '#9F7E6C' }}>要約</span>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={3}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '12px', color: '#9F7E6C' }}>公開日（YYYY-MM-DD）</span>
          <input
            value={publishedDate}
            onChange={(e) => setPublishedDate(e.target.value)}
            placeholder="2026-01-15"
            style={inputStyle}
          />
        </label>

        {error && <p style={{ fontSize: '12px', color: '#D14F4F' }}>{error}</p>}

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' }}>
          <button onClick={onCancel} disabled={isSubmitting} style={secondaryButtonStyle}>
            キャンセル
          </button>
          <button onClick={handleSubmit} disabled={isSubmitting} style={primaryButtonStyle}>
            {isSubmitting ? '保存中...' : '保存する'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── 記事1行 ─────────────────────────────────────────────────────────────────

function ArticleRow({ article, onEdit }: { article: BlogArticle; onEdit: () => void }) {
  const { deleteArticle } = useKnowledgeImportStore()
  const [confirming, setConfirming] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [rowError, setRowError] = useState<string | null>(null)

  const handleDelete = async () => {
    setIsDeleting(true)
    setRowError(null)
    const result = await deleteArticle(article.id)
    setIsDeleting(false)
    if (!result.success) {
      setRowError(result.error ?? '削除に失敗しました')
      setConfirming(false)
    }
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #F5EEF0', borderRadius: '16px', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px', flexWrap: 'wrap' }}>
            {article.category && (
              <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px', flexShrink: 0, background: '#F0F5FA', color: '#4878A8' }}>
                {article.category}
              </span>
            )}
            <p style={{ fontSize: '14px', fontWeight: 700, color: '#5C4033' }}>{article.title}</p>
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
          {article.publishedAt && (
            <p style={{ fontSize: '11px', color: '#C8A8B0', marginTop: '2px' }}>公開日: {article.publishedAt}</p>
          )}
        </div>
        <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
          <button onClick={onEdit} aria-label="編集" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9F7E6C', display: 'flex' }}>
            <Pencil size={16} />
          </button>
          <button onClick={() => setConfirming(true)} aria-label="削除" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#D14F4F', display: 'flex' }}>
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {article.summary && (
        <p style={{ fontSize: '12px', color: '#7A5F52', lineHeight: 1.5 }}>{article.summary}</p>
      )}

      {article.keywords.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {article.keywords.map((k) => (
            <span key={k} style={{ fontSize: '10px', padding: '3px 8px', borderRadius: '999px', background: '#FDEEF1', color: '#D98292' }}>
              #{k}
            </span>
          ))}
        </div>
      )}

      {confirming && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#FFF8F7', borderRadius: '10px', padding: '8px 10px' }}>
          <span style={{ fontSize: '12px', color: '#5C4033', flex: 1 }}>この記事を削除しますか?（元に戻せません）</span>
          <button onClick={handleDelete} disabled={isDeleting} style={{ fontSize: '12px', fontWeight: 700, padding: '6px 12px', borderRadius: '8px', border: 'none', background: '#D14F4F', color: '#fff', cursor: 'pointer' }}>
            {isDeleting ? '削除中...' : '削除する'}
          </button>
          <button onClick={() => setConfirming(false)} disabled={isDeleting} style={secondaryButtonStyle}>
            キャンセル
          </button>
        </div>
      )}

      {rowError && <p style={{ fontSize: '12px', color: '#D14F4F' }}>{rowError}</p>}
    </div>
  )
}

// ─── 共通スタイル ────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = { border: '1px solid #F5EEF0', borderRadius: '10px', padding: '8px 10px', fontSize: '14px' }
const primaryButtonStyle: React.CSSProperties = { fontSize: '13px', fontWeight: 700, padding: '9px 16px', borderRadius: '10px', border: 'none', background: '#D98292', color: '#fff', cursor: 'pointer' }
const secondaryButtonStyle: React.CSSProperties = { fontSize: '12px', fontWeight: 600, padding: '6px 12px', borderRadius: '8px', border: '1px solid #F5EEF0', background: '#fff', color: '#9F7E6C', cursor: 'pointer' }

// ─── メイン画面 ──────────────────────────────────────────────────────────────

export default function KnowledgeImportScreen() {
  const {
    articles, isLoading, error, fetchArticles,
    previewRows, skippedRows, isPreviewing, previewError, previewCsv, clearPreview,
    isImporting, importError, commitImport,
    updateArticle,
  } = useKnowledgeImportStore()

  const [editing, setEditing] = useState<BlogArticle | null>(null)
  const [importResultMsg, setImportResultMsg] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [titleQuery, setTitleQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')

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
      return true
    })
  }, [articles, titleQuery, categoryFilter])

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImportResultMsg(null)
    const text = await file.text()
    await previewCsv(text)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleCommit = async () => {
    const result = await commitImport()
    if (result.success) {
      setImportResultMsg(`${result.imported}件を取り込みました${result.failed > 0 ? `（失敗: ${result.failed}件）` : ''}`)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '16px', maxWidth: '480px' }}>
      <div>
        <p style={{ fontSize: '10px', fontWeight: 700, color: '#C8A8B0', letterSpacing: '0.1em', marginBottom: '2px' }}>
          KNOWLEDGE IMPORT
        </p>
        <h1 style={{ fontSize: '18px', fontWeight: 700, color: '#5C4033' }}>ナレッジ取込（CSV）</h1>
        <p style={{ fontSize: '12px', color: '#9F7E6C', marginTop: '4px' }}>
          CSVをアップロードし、内容をそのまま登録します（要約・タグの自動生成は行いません）。
        </p>
      </div>

      {/* ─── CSVアップロード ─── */}
      <div style={{ background: '#fff', border: '1px solid #F5EEF0', borderRadius: '16px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <p style={{ fontSize: '13px', fontWeight: 700, color: '#5C4033' }}>CSVアップロード</p>
        <p style={{ fontSize: '11px', color: '#9F7E6C', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
          列: title, url, category, keywords, summary, published_date{'\n'}
          （title / url / summary は必須。category / keywords / published_date は省略可）
        </p>
        <details style={{ fontSize: '11px', color: '#9F7E6C' }}>
          <summary style={{ cursor: 'pointer' }}>CSVの例を見る</summary>
          <pre style={{ background: '#FFF8F7', borderRadius: '8px', padding: '8px', fontSize: '10px', overflowX: 'auto', marginTop: '6px' }}>{CSV_SAMPLE}</pre>
        </details>

        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 700, padding: '9px 14px', borderRadius: '10px', border: '1px dashed #D98292', color: '#D98292', cursor: 'pointer', width: 'fit-content' }}>
          <Upload size={14} />
          CSVファイルを選択
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={handleFileChange} style={{ display: 'none' }} />
        </label>

        {isPreviewing && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#C8A8B0', fontSize: '12px' }}>
            <Loader2 size={14} className="animate-spin" /> 検証中...
          </div>
        )}

        {previewError && <p style={{ fontSize: '12px', color: '#D14F4F' }}>{previewError}</p>}

        {(previewRows.length > 0 || skippedRows.length > 0) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: '#FFF8F7', borderRadius: '10px', padding: '10px' }}>
            <p style={{ fontSize: '12px', fontWeight: 700, color: '#5C4033' }}>
              プレビュー: 取込可能 {previewRows.length}件 / スキップ {skippedRows.length}件
            </p>

            {previewRows.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '160px', overflowY: 'auto' }}>
                {previewRows.map((r, i) => (
                  <p key={i} style={{ fontSize: '11px', color: '#7A5F52' }}>・{r.title}</p>
                ))}
              </div>
            )}

            {skippedRows.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '160px', overflowY: 'auto' }}>
                {skippedRows.map((s, i) => (
                  <p key={i} style={{ fontSize: '11px', color: '#D14F4F' }}>
                    {s.lineNumber}行目: {s.reason}
                  </p>
                ))}
              </div>
            )}

            {importError && <p style={{ fontSize: '12px', color: '#D14F4F' }}>{importError}</p>}

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={clearPreview} disabled={isImporting} style={secondaryButtonStyle}>
                キャンセル
              </button>
              <button onClick={handleCommit} disabled={isImporting || previewRows.length === 0} style={primaryButtonStyle}>
                {isImporting ? '取込中...' : `${previewRows.length}件を取り込む`}
              </button>
            </div>
          </div>
        )}

        {importResultMsg && <p style={{ fontSize: '12px', color: '#34A070', fontWeight: 700 }}>{importResultMsg}</p>}
      </div>

      {/* ─── 一覧 ─── */}
      <div>
        <p style={{ fontSize: '13px', fontWeight: 700, color: '#5C4033', marginBottom: '8px' }}>登録済み一覧（{articles.length}件）</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px' }}>
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

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            style={{ alignSelf: 'flex-start', fontSize: '12px', padding: '7px 10px', borderRadius: '10px', border: '1px solid #F5EEF0', background: '#fff', color: '#5C4033' }}
          >
            <option value="all">カテゴリ: すべて</option>
            {categoryOptions.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

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
            <button onClick={() => fetchArticles()} style={{ fontSize: '12px', fontWeight: 700, padding: '6px 14px', borderRadius: '999px', border: 'none', background: '#D98292', color: '#fff', cursor: 'pointer', flexShrink: 0 }}>
              再読み込み
            </button>
          </div>
        )}

        {!isLoading && !error && articles.length === 0 && (
          <div style={{ padding: '40px 0', textAlign: 'center', color: '#C8A8B0', fontSize: '13px' }}>
            まだ何も登録されていません
          </div>
        )}

        {!isLoading && !error && articles.length > 0 && filteredArticles.length === 0 && (
          <div style={{ padding: '40px 0', textAlign: 'center', color: '#C8A8B0', fontSize: '13px' }}>
            条件に一致する記事がありません
          </div>
        )}

        {!isLoading && !error && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {filteredArticles.map((article) => (
              <ArticleRow key={article.id} article={article} onEdit={() => setEditing(article)} />
            ))}
          </div>
        )}
      </div>

      {editing && (
        <EditModal
          article={editing}
          onCancel={() => setEditing(null)}
          onSubmit={async (input) => {
            const result = await updateArticle(editing.id, input)
            if (result.success) setEditing(null)
            return result
          }}
        />
      )}
    </div>
  )
}
