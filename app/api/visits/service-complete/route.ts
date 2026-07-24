/**
 * POST /api/visits/service-complete (RecordServiceCompletion, Phase 1-E)
 *
 * 接客ログ画面(src/components/customer/CustomerBottomSheet.tsx の saveLog())から
 * 呼ばれる。「次回予約が取れたか」をbrain_visits.next_booking_madeへ実際に反映する
 * ための経路(recordProposalOutcome.tsはvisit.nextBookingMadeを読むだけで、それを
 * 書き込む経路がこれまで存在しなかった)。
 *
 * - staffIdはBearerトークンから解決する(extractStaffFromRequest)。client供給値は使わない。
 * - menuNameはCSV取込と同じmenuResolver.resolveMenuId()でbrain_menus.idへ解決する
 *   (このスクリーンはメニュー名の文字列しか保持していないため)。解決できない場合は
 *   422を返し、呼び出し元は非致命的に無視する(接客ログ本体の保存は別経路で完了済みのため)。
 * - 当日分の既存visit(findByCustomerAndDate、主にCSV取込前のstaff_input行)があれば
 *   visitRepo.updateNextBookingMade()で更新するのみに留める(staffId/menuId等は
 *   触らない)。無ければvisitRepo.createSequenced()で新規作成する(source既定値
 *   'staff_input'。CSV取込のreconcile()が後からstaffId/menuId/金額を正しい値に
 *   上書きする前提の設計。既存のcsvImportPipeline.ts/recordProposalOutcome.tsは無変更)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos } from '../../../lib/repos';
import { serviceCompleteInputSchema } from '../../_schemas/visit';
import { toValidationErrorResponse } from '../../_schemas/common';
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest';
import { buildMenuLookup, resolveMenuId } from '@/lib/import/menuResolver';

function todayDateOnly(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(req: NextRequest) {
  const staff = await extractStaffFromRequest(req);
  if (!staff?.staffBrainId) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 });
  }

  const parsed = serviceCompleteInputSchema.safeParse(body);
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

    const menus = await repos.menuRepo.listByStore(customer.storeId);
    const menuLookup = buildMenuLookup(menus);
    const menuRes = resolveMenuId(input.menuName, menuLookup);
    if (menuRes.status === 'unresolved') {
      return NextResponse.json({ success: false, error: 'menu_unresolved' }, { status: 422 });
    }

    const visitDate = todayDateOnly();
    const existing = await repos.visitRepo.findByCustomerAndDate(input.customerId, visitDate);

    if (existing) {
      await repos.visitRepo.updateNextBookingMade(existing.id, input.nextBookingMade);
      return NextResponse.json({ success: true, visitId: existing.id, created: false }, { status: 200 });
    }

    const visit = await repos.visitRepo.createSequenced({
      storeId: customer.storeId,
      customerId: input.customerId,
      staffId: staff.staffBrainId,
      menuId: menuRes.menuId,
      visitDate,
      isNomination: false,
      treatmentAmount: 0,
      retailAmount: 0,
      retailCategory: null,
      homecarePurchased: input.homecarePurchased ?? false,
      homecareDeclined: false,
      nextBookingMade: input.nextBookingMade,
      noBookingReason: null,
      voiceMemoUrl: null,
      visitScore: 0,
    });

    return NextResponse.json({ success: true, visitId: visit.id, created: true }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
