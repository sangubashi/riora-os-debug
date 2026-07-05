/**
 * GET /api/admin/churn-risk?storeId=...&date=... (画面②離脱予兆センター・MD-2)
 *
 * brain_customers/brain_visits/brain_staffをその場で集計し、危険顧客一覧を返す
 * (ChurnRiskEngine.computeChurnRisk・決定論ルール・LLM不使用)。
 * 設計根拠: docs/architecture/Riora_Management_Dashboard_Architecture_v2.0.md 画面②
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos } from '../../../lib/repos';
import { churnRiskQuerySchema } from '../../_schemas/query';
import { toValidationErrorResponse } from '../../_schemas/common';
import { computeChurnRisk } from '@/lib/churn/ChurnRiskEngine';
import { requireAdmin } from '@/lib/auth/requireAdmin';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const parsed = churnRiskQuerySchema.safeParse({
    storeId: req.nextUrl.searchParams.get('storeId'),
    date: req.nextUrl.searchParams.get('date') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(toValidationErrorResponse(parsed.error), { status: 400 });
  }

  const { storeId } = parsed.data;
  const date = parsed.data.date ?? todayIso();

  let repos;
  try {
    repos = getRepos();
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }

  try {
    const [customers, visits, staff] = await Promise.all([
      repos.customerRepo.listByStore(storeId),
      repos.visitRepo.listByStore(storeId),
      repos.staffRepo.listByStore(storeId),
    ]);

    const dangerCustomers = computeChurnRisk({ asOfDate: date, customers, visits, staff });

    return NextResponse.json({ success: true, storeId, date, dangerCustomers });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
