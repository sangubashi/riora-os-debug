/**
 * PATCH/DELETE /api/admin/blog-articles/:id (BLOG_CONTENT_PHASE1 — 管理者専用)
 *
 * PATCH: 記事編集(title/sourceUrl/products/keywords)と「承認切替」
 * (isCustomerSafe ON/OFF)の両方をこのエンドポイントで受ける。isCustomerSafeが
 * 送られた場合、statusを連動して更新する(true→'approved'、false→'draft')。
 * これはBlogArticleRepoの責務ではなくAPI層の方針として明示的にここで決める
 * (statusを独立してクライアントから設定させない設計)。
 *
 * DELETE: 物理削除(論理削除は行わない・依頼仕様どおり)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos } from '../../../../lib/repos';
import { idSchema, toValidationErrorResponse } from '../../../_schemas/common';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { updateBlogArticleBodySchema } from '../../../_schemas/blogArticle';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  const idResult = idSchema.safeParse(id);
  if (!idResult.success) {
    return NextResponse.json(toValidationErrorResponse(idResult.error), { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 });
  }

  const parsed = updateBlogArticleBodySchema.safeParse(body);
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
    const { isCustomerSafe, ...rest } = parsed.data;
    const article = await repos.blogArticleRepo.update(idResult.data, {
      ...rest,
      ...(isCustomerSafe !== undefined
        ? { isCustomerSafe, status: isCustomerSafe ? ('approved' as const) : ('draft' as const) }
        : {}),
    });
    if (!article) {
      return NextResponse.json({ success: false, error: 'article_not_found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, article });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  const idResult = idSchema.safeParse(id);
  if (!idResult.success) {
    return NextResponse.json(toValidationErrorResponse(idResult.error), { status: 400 });
  }

  let repos;
  try {
    repos = getRepos();
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }

  try {
    const deleted = await repos.blogArticleRepo.delete(idResult.data);
    if (!deleted) {
      return NextResponse.json({ success: false, error: 'article_not_found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
