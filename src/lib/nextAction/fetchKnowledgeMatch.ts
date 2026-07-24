/**
 * fetchKnowledgeMatch.ts — knowledgeMatch.tsの候補語を使って
 * /api/blog-articles/knowledge-match を呼ぶクライアント専用ラッパー。
 *
 * authedFetch（ブラウザのセッション情報に依存）を使うため、サーバー側のAPI route
 * からは呼ばない（サーバー側は同等のRepositoryクエリを直接実行する）。
 * 記事本文・タイトル・summaryはここでも一切扱わない。失敗時は空配列を返す
 * （フェイルセーフ。既存の関連記事取得と同じ方針）。
 */
import { authedFetch } from '@/lib/api/authedFetch'

export interface KnowledgeMatchResult {
  matchedKeywords:   string[]
  matchedCategories: string[]
}

export async function fetchKnowledgeMatch(
  keywordVocabulary: string[],
  categoryVocabulary: string[] = []
): Promise<KnowledgeMatchResult> {
  if (keywordVocabulary.length === 0 && categoryVocabulary.length === 0) {
    return { matchedKeywords: [], matchedCategories: [] }
  }
  try {
    const params = new URLSearchParams()
    for (const kw of keywordVocabulary) params.append('keywords', kw)
    for (const cat of categoryVocabulary) params.append('categories', cat)
    const res = await authedFetch(`/api/blog-articles/knowledge-match?${params.toString()}`)
    if (!res.ok) return { matchedKeywords: [], matchedCategories: [] }
    const json = await res.json() as { success: boolean; matchedKeywords?: string[]; matchedCategories?: string[] }
    return json.success
      ? { matchedKeywords: json.matchedKeywords ?? [], matchedCategories: json.matchedCategories ?? [] }
      : { matchedKeywords: [], matchedCategories: [] }
  } catch {
    return { matchedKeywords: [], matchedCategories: [] }
  }
}
