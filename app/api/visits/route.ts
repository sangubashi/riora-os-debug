/**
 * POST /api/visits (SaveVisitRecord)
 *
 * VisitInputを受け取り、brain_visitsへ1件追加する。
 * - storeIdはcustomerRepo.findById()から取得する(入力には含まれない)。
 * - visitCountAtはvisitRepo.createSequenced()(RPC public.insert_visit_with_sequence、
 *   MD-5B/MD-5E)がDB側でpg_advisory_xact_lock配下で原子的に採番する。
 * - treatmentAmount/visitScoreはDBデフォルト(0)に合わせて0を設定する
 *   (Engine呼び出し禁止のため、本Stepではスコアリングを行わない)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos } from '../../lib/repos';
import { visitInputSchema } from '../_schemas/visit';
import { toValidationErrorResponse } from '../_schemas/common';
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest';

export async function POST(req: NextRequest) {
  const staff = await extractStaffFromRequest(req);
  if (!staff) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 });
  }

  const parsed = visitInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(toValidationErrorResponse(parsed.error), { status: 400 });
  }
  const input = parsed.data;

  let repos;
  try {
    repos = getRepos();
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }

  try {
    const customer = await repos.customerRepo.findById(input.customerId);
    if (!customer) {
      return NextResponse.json({ success: false, error: 'customer_not_found' }, { status: 404 });
    }

    const visit = await repos.visitRepo.createSequenced({
      storeId: customer.storeId,
      customerId: input.customerId,
      staffId: input.staffId,
      menuId: input.menuId,
      visitDate: new Date().toISOString(),
      isNomination: input.isNomination,
      treatmentAmount: 0,
      retailAmount: input.retailAmount ?? 0,
      retailCategory: input.retailCategory ?? null,
      homecarePurchased: input.homecarePurchased,
      homecareDeclined: input.homecareDeclined ?? false,
      nextBookingMade: input.nextBookingMade,
      noBookingReason: input.noBookingReason ?? null,
      voiceMemoUrl: input.voiceMemoUrl ?? null,
      visitScore: 0,
    });

    return NextResponse.json({ success: true, visit }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
