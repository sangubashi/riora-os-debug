/**
 * POST /api/admin/customer-type/classify?storeId=... — CustomerTypeEngine実行(Pass H)
 *
 * 店舗の全顧客に対しCustomerTypeEngineを適用し、brain_customers.customer_type/
 * type_confidenceへ保存する。既に設定済みの顧客は上書きしない。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos } from '../../../../lib/repos';
import { runCustomerTypeClassification } from '@/lib/customerType/runCustomerTypeClassification';
import { classifyQuerySchema } from '../../../_schemas/customerType';
import { toValidationErrorResponse } from '../../../_schemas/common';
import { requireAdmin } from '@/lib/auth/requireAdmin';

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const parsed = classifyQuerySchema.safeParse({
    storeId: req.nextUrl.searchParams.get('storeId'),
  });
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
    const summary = await runCustomerTypeClassification(parsed.data.storeId, repos);
    return NextResponse.json({ success: true, summary });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
