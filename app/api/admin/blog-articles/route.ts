/**
 * GET/POST /api/admin/blog-articles (BLOG_CONTENT_PHASE1 — 管理者専用)
 *
 * brain_blog_articlesのCRUD専用エンドポイント。記事本文の取得・保存は行わない
 * (URL登録のみの方針。スクレイピング禁止)。薬機法チェック・AI判定は一切行わない
 * (is_customer_safeは[id]/route.tsのPATCHで管理者が手動でON/OFFするだけ)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos } from '../../../lib/repos';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { createBlogArticleBodySchema } from '../../_schemas/blogArticle';
import { toValidationErrorResponse } from '../../_schemas/common';

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

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 });
  }

  const parsed = createBlogArticleBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(toValidationErrorResponse(parsed.error), { status: 400 });
  }

  let repos;
  try {
    repos = getRepos();
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }

  try {
    const article = await repos.blogArticleRepo.create(parsed.data);
    return NextResponse.json({ success: true, article });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
