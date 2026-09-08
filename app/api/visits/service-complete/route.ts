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
 * - 写真カルテ「写真→visit自動紐付け」Phase 1: visitが解決された直後(既存発見/新規作成の
 *   いずれも)に、同一顧客・同一visit_date(JST暦日)でvisit_id未設定(NULL)の写真を
 *   そのvisitへ紐付ける(linkUnattachedPhotosToVisit、src/lib/photos/linkPhotosToVisit.ts)。
 *   brain_visitsの作成/採番ロジックには関与しない下流の非致命的処理で、失敗しても
 *   本APIの成功レスポンス(接客ログ保存自体)には影響させない。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos } from '../../../lib/repos';
import { serviceCompleteInputSchema } from '../../_schemas/visit';
import { toValidationErrorResponse } from '../../_schemas/common';
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest';
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer';
import { buildMenuLookup, resolveMenuId } from '@/lib/import/menuResolver';
import { linkUnattachedPhotosToVisit } from '@/lib/photos/linkPhotosToVisit';

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

    // SECURITY_FINAL_AUDIT H-4: 担当外顧客への接客完了記録(次回予約/ホームケア購入等)
    // 作成を防ぐ。staffIdは既にトークンから解決済み(なりすまし不可)だが、customerIdへの
    // アクセス権チェックが無かったため追加する。
    const accessible = await canAccessCustomer(staff.staffBrainId, input.customerId, staff.isAdmin);
    if (!accessible) {
      return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 });
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

      // 写真カルテ Phase 1(非致命的・visit_count_at等には一切影響しない): 同一顧客・
      // 同一visit_date(JST暦日)でvisit_id未設定の写真をこのvisitへ紐付ける。
      try {
        const linkResult = await linkUnattachedPhotosToVisit({
          customerId: input.customerId,
          visitId:    existing.id,
          visitDate:  existing.visitDate,
        });
        if (!linkResult.ok) {
          console.warn('[service-complete] photo link failed (non-fatal):', linkResult.error);
        }
      } catch (e) {
        console.warn('[service-complete] photo link failed (non-fatal):', e);
      }

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

    // 写真カルテ Phase 1(非致命的・visit_count_at等には一切影響しない): 同一顧客・
    // 同一visit_date(JST暦日)でvisit_id未設定の写真をこのvisitへ紐付ける。
    try {
      const linkResult = await linkUnattachedPhotosToVisit({
        customerId: input.customerId,
        visitId:    visit.id,
        visitDate:  visit.visitDate,
      });
      if (!linkResult.ok) {
        console.warn('[service-complete] photo link failed (non-fatal):', linkResult.error);
      }
    } catch (e) {
      console.warn('[service-complete] photo link failed (non-fatal):', e);
    }

    return NextResponse.json({ success: true, visitId: visit.id, created: true }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
