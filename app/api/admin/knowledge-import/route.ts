/**
 * GET /api/admin/knowledge-import (KNOWLEDGE_IMPORT_PHASE1 — 管理者専用)
 *
 * ナレッジ取込画面(/admin/knowledge-import)の一覧取得。brain_blog_articlesを
 * そのまま返す。既存の/api/admin/blog-articlesとは別経路とし、既存ルート・
 * 既存画面(/admin/blog-content)は一切変更しない。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos } from '../../../lib/repos';
import { requireAdmin } from '@/lib/auth/requireAdmin';

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  let repos;
  try {
    repos = getRepos();
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }

  try {
    const articles = await repos.blogArticleRepo.listAll();
    return NextResponse.json({ success: true, articles });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
