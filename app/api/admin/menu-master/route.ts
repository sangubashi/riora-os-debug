/**
 * GET/POST /api/admin/menu-master?storeId=... (メニューマスタ管理画面)
 *
 * brain_menusのCRUD専用エンドポイント。既存 GET /api/admin/menu(集計専用・閲覧のみ)
 * とは責務を分離し、本ルートは編集操作(作成)を担う。
 * 設計根拠: docs/MENU_MASTER_IMPLEMENTATION_PLAN.md / docs/MENU_MASTER_IMPLEMENTATION_REVIEW.md
 *
 * role='imported_other'は新規作成時の選択肢から除外する(CSV突合エンジンのフォールバック
 * 専用行のため。既存の1件のみが正であり、新規作成での複製を防ぐ)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getRepos } from '../../../lib/repos';
import { DEMO_STORE_ID } from '@/lib/constants';
import { toValidationErrorResponse } from '../../_schemas/common';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { EDITABLE_MENU_ROLES, ALL_CUSTOMER_TYPES } from '@/lib/menu/menuMasterConstants';

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const storeId = req.nextUrl.searchParams.get('storeId') || DEMO_STORE_ID;

  let repos;
  try {
    repos = getRepos();
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }

  try {
    const menus = await repos.menuRepo.listByStore(storeId);
    return NextResponse.json({ success: true, menus });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}

const createBodySchema = z.object({
  storeId: z.string().min(1).optional(),
  name: z.string().min(1),
  price: z.number().int().min(0),
  role: z.enum(EDITABLE_MENU_ROLES),
  targetTypes: z.array(z.enum(ALL_CUSTOMER_TYPES)).default([]),
});

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 });
  }

  const parsed = createBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(toValidationErrorResponse(parsed.error), { status: 400 });
  }
  const { storeId, name, price, role, targetTypes } = parsed.data;

  let repos;
  try {
    repos = getRepos();
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }

  try {
    const menu = await repos.menuRepo.create({
      storeId: storeId || DEMO_STORE_ID,
      name,
      price,
      role,
      targetTypes,
    });
    return NextResponse.json({ success: true, menu });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
