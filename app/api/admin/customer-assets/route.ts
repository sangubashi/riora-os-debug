/**
 * GET /api/admin/customer-assets?storeId=... (画面③顧客管理・MD-3)
 *
 * brain_customers/brain_visits/brain_subscriptionsをその場で集計し、顧客一覧
 * (来店回数/最終来店日/LTV/累計売上/指名状況/来店間隔)を返す
 * (CustomerAssetEngine.computeCustomerAssets・決定論ルール・LLM不使用)。
 *
 * 閲覧専用API(GETのみ)。ユーザー指示(2026-06-23)により顧客編集・削除は
 * 本画面の責務外のため、POST/PATCH/DELETEは実装しない。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos } from '../../../lib/repos';
import { customerAssetsQuerySchema } from '../../_schemas/query';
import { toValidationErrorResponse } from '../../_schemas/common';
import { computeCustomerAssets } from '@/lib/customerAssets/CustomerAssetEngine';
import { requireAdmin } from '@/lib/auth/requireAdmin';

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const parsed = customerAssetsQuerySchema.safeParse({
    storeId: req.nextUrl.searchParams.get('storeId'),
  });
  if (!parsed.success) {
    return NextResponse.json(toValidationErrorResponse(parsed.error), { status: 400 });
  }

  const { storeId } = parsed.data;

  let repos;
  try {
    repos = getRepos();
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }

  try {
    const [customers, visits, subscriptions] = await Promise.all([
      repos.customerRepo.listByStore(storeId),
      repos.visitRepo.listByStore(storeId),
      repos.subscriptionRepo.listByStore(storeId),
    ]);

    const customerAssets = computeCustomerAssets({ customers, visits, subscriptions });

    return NextResponse.json({ success: true, storeId, customerAssets });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
