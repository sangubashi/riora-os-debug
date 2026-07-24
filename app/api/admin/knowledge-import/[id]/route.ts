/**
 * PATCH/DELETE /api/admin/knowledge-import/:id (KNOWLEDGE_IMPORT_PHASE1 — 管理者専用)
 *
 * PATCH: title/sourceUrl/category/keywords/summary/publishedAtの編集のみを扱う。
 * isCustomerSafe/status(承認ワークフロー)はこの画面のスコープ外のため一切扱わない
 * (既存の/api/admin/blog-articles/[id]が承認切替を担当する。本ルートは変更しない)。
 *
 * DELETE: 物理削除(既存の/api/admin/blog-articles/[id]と同様の挙動)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos } from '../../../../lib/repos';
import { idSchema, toValidationErrorResponse } from '../../../_schemas/common';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { knowledgeImportUpdateBodySchema } from '../../../_schemas/knowledgeImport';

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

  const parsed = knowledgeImportUpdateBodySchema.safeParse(body);
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
    const article = await repos.blogArticleRepo.update(idResult.data, parsed.data);
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
