/**
 * GET/POST /api/admin/staff-aliases?storeId=... (画面⑥スタッフ名エイリアス管理)
 *
 * brain_staff.name_aliases(JSONB)の閲覧・追加。スタッフ単位の配列のみで
 * 別名ごとの登録日時は保持されないため、既存登録分はcreatedAt=''(UI側で「登録日時不明」表示)、
 * このリクエストで新規追加した分のみ実時刻を返す。
 * 設計根拠: docs/architecture/Riora_Management_Dashboard_Architecture_v2.1.md §2,4,5
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getRepos } from '../../../lib/repos';
import { DEMO_STORE_ID } from '@/lib/constants';
import { toValidationErrorResponse } from '../../_schemas/common';
import type { StaffAlias, StaffAliasListResponse, StaffOption } from '@/components/admin/csv-import/types';
import { requireAdmin } from '@/lib/auth/requireAdmin';

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
    const staff = await repos.staffRepo.listByStore(storeId);
    const staffOptions: StaffOption[] = staff.map((s) => ({ id: s.id, name: s.name }));
    const aliases: StaffAlias[] = staff.flatMap((s) =>
      s.nameAliases.map((alias) => ({
        id: `${s.id}:${alias}`,
        alias,
        staffId: s.id,
        staffName: s.name,
        createdAt: '',
        createdBy: '',
      }))
    );

    const response: StaffAliasListResponse = { staffOptions, aliases };
    return NextResponse.json({ success: true, ...response });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}

const postBodySchema = z.object({
  storeId: z.string().min(1).optional(),
  alias: z.string().min(1),
  staffId: z.string().min(1),
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

  const parsedBody = postBodySchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(toValidationErrorResponse(parsedBody.error), { status: 400 });
  }
  const { alias, staffId } = parsedBody.data;

  let repos;
  try {
    repos = getRepos();
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }

  try {
    const staff = await repos.staffRepo.addNameAlias(staffId, alias);
    if (!staff) {
      return NextResponse.json({ success: false, error: 'staff_not_found' }, { status: 404 });
    }

    const created: StaffAlias = {
      id: `${staff.id}:${alias}`,
      alias,
      staffId: staff.id,
      staffName: staff.name,
      createdAt: new Date().toISOString(),
      createdBy: 'owner',
    };
    return NextResponse.json({ success: true, ...created });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
