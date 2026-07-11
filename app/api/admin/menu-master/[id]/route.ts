/**
 * PATCH/DELETE /api/admin/menu-master/:id (メニューマスタ管理画面)
 *
 * role='imported_other'の行は編集・削除ともに禁止する(CSV突合エンジンの
 * menuResolver.tsがrole値でこの行を特定してフォールバック先として使うため。
 * この行が変更・消失するとCSV取込のimport処理自体が失敗する)。
 *
 * 削除は論理削除(deleted_at)のみ(brain_visits.menu_idがON DELETE RESTRICTのため
 * 物理削除は選択肢にない)。かつ、当該menu_idを参照するbrain_visitsが1件でも
 * 存在する場合は削除自体を拒否する(参照中の削除拒否・PHASE MENU-UI-3確定仕様)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getRepos } from '../../../../lib/repos';
import { idSchema, toValidationErrorResponse } from '../../../_schemas/common';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { EDITABLE_MENU_ROLES, ALL_CUSTOMER_TYPES } from '@/lib/menu/menuMasterConstants';

const updateBodySchema = z.object({
  name: z.string().min(1).optional(),
  price: z.number().int().min(0).optional(),
  role: z.enum(EDITABLE_MENU_ROLES).optional(),
  targetTypes: z.array(z.enum(ALL_CUSTOMER_TYPES)).optional(),
});

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

  const parsed = updateBodySchema.safeParse(body);
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
    const existing = await repos.menuRepo.findById(idResult.data);
    if (!existing) {
      return NextResponse.json({ success: false, error: 'menu_not_found' }, { status: 404 });
    }
    if (existing.role === 'imported_other') {
      return NextResponse.json({ success: false, error: 'imported_other_protected' }, { status: 403 });
    }

    const menu = await repos.menuRepo.update(idResult.data, parsed.data);
    if (!menu) {
      return NextResponse.json({ success: false, error: 'menu_not_found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, menu });
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
    const existing = await repos.menuRepo.findById(idResult.data);
    if (!existing) {
      return NextResponse.json({ success: false, error: 'menu_not_found' }, { status: 404 });
    }
    if (existing.role === 'imported_other') {
      return NextResponse.json({ success: false, error: 'imported_other_protected' }, { status: 403 });
    }

    const usageCount = await repos.menuRepo.countVisitsByMenuId(idResult.data);
    if (usageCount > 0) {
      return NextResponse.json({ success: false, error: 'menu_in_use', usageCount }, { status: 409 });
    }

    await repos.menuRepo.softDelete(idResult.data);
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
