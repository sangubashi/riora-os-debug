/**
 * GET /api/customers/:id (GetCustomerDetail)
 *
 * brain_customers 1件 + brain_visits直近n件(既定5件)を返す。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos } from '../../../lib/repos';
import { idSchema, toValidationErrorResponse } from '../../_schemas/common';
import { recentVisitsLimitSchema } from '../../_schemas/query';
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest';
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const staff = await extractStaffFromRequest(req)
  if (!staff) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 })
  }

  const { id } = await params;

  const idResult = idSchema.safeParse(id);
  if (!idResult.success) {
    return NextResponse.json(toValidationErrorResponse(idResult.error), { status: 400 });
  }

  const limitResult = recentVisitsLimitSchema.safeParse(req.nextUrl.searchParams.get('limit') ?? undefined);
  if (!limitResult.success) {
    return NextResponse.json(toValidationErrorResponse(limitResult.error), { status: 400 });
  }

  let repos;
  try {
    repos = getRepos();
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }

  try {
    const customer = await repos.customerRepo.findById(idResult.data);
    if (!customer) {
      return NextResponse.json({ success: false, error: 'customer_not_found' }, { status: 404 });
    }

    const accessible = await canAccessCustomer(staff.staffBrainId, idResult.data, staff.isAdmin)
    if (!accessible) {
      return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 })
    }

    const recentVisits = await repos.visitRepo.recentByCustomer(idResult.data, limitResult.data);

    return NextResponse.json({ success: true, customer, recentVisits });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
