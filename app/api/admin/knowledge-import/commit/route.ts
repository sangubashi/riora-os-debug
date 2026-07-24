/**
 * POST /api/admin/knowledge-import/commit (KNOWLEDGE_IMPORT_PHASE1 — 管理者専用)
 *
 * プレビューで検証済みの行を確定登録する。brain_blog_articlesへそのまま保存する
 * (LLM要約・タグ抽出・薬機法チェック等の加工は一切行わない。CSV内容をそのまま保存)。
 * 1行ずつ登録し、一部の行が失敗しても他行の登録は継続する(failedに理由を積んで返す)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos } from '../../../../lib/repos';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { knowledgeImportCommitBodySchema } from '../../../_schemas/knowledgeImport';
import { toValidationErrorResponse } from '../../../_schemas/common';
import type { BlogArticle } from '@/types/riora.types';

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 });
  }

  const parsed = knowledgeImportCommitBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(toValidationErrorResponse(parsed.error), { status: 400 });
  }

  let repos;
  try {
    repos = getRepos();
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }

  const imported: BlogArticle[] = [];
  const failed: { index: number; error: string }[] = [];

  for (let i = 0; i < parsed.data.rows.length; i++) {
    const row = parsed.data.rows[i];
    try {
      const article = await repos.blogArticleRepo.create({
        title: row.title,
        sourceUrl: row.sourceUrl,
        products: [],
        keywords: row.keywords,
        category: row.category ?? null,
        summary: row.summary,
        publishedAt: row.publishedAt ?? null,
      });
      imported.push(article);
    } catch (e) {
      failed.push({ index: i, error: String(e) });
    }
  }

  return NextResponse.json({ success: true, imported, failed });
}
