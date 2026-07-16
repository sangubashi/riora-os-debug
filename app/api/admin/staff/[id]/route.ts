/**
 * PATCH /api/admin/staff/[id] — 退職処理(brain_staff.is_active=false)
 * STAFF_MANAGEMENT_PHASE1_IMPLEMENT_1: 退職処理のみ。氏名・role編集はPhase3の範囲外。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos } from '../../../../lib/repos';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { idSchema, toValidationErrorResponse } from '../../../_schemas/common';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    const staff = await repos.staffRepo.deactivate(idResult.data);
    if (!staff) {
      return NextResponse.json({ success: false, error: 'staff_not_found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, staff });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
