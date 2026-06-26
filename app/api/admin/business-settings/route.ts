/**
 * GET/POST /api/admin/business-settings(MD-1: 固定費設定UI / variable_rates設定UI)
 *
 * 設計根拠:
 *   - docs/architecture/Riora_Management_Dashboard_Architecture_v2.0.md 画面①
 *     「固定費の内訳は[詳しく]で展開」
 *   - docs/architecture/Riora_損益分岐・コスト構造_設計書_v1.0.md §4
 *     business_settings拡張項目(fixed_costs jsonb / variable_rates jsonb)
 *
 * GET: brain_business_settingsを1件取得する(設定画面の初期表示用)。
 * POST: (store_id, month)へUPSERTする。損益分岐点・利益予測の計算式は
 *   DashboardAggregator側にあり、本ルートは入力データの保存のみを行う(計算しない)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos } from '../../../lib/repos';
import { storeIdQuerySchema } from '../../_schemas/query';
import { businessSettingsUpsertSchema } from '../../_schemas/businessSettings';
import { toValidationErrorResponse } from '../../_schemas/common';

function firstOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export async function GET(req: NextRequest) {
  const parsed = storeIdQuerySchema.safeParse({
    storeId: req.nextUrl.searchParams.get('storeId'),
  });
  if (!parsed.success) {
    return NextResponse.json(toValidationErrorResponse(parsed.error), { status: 400 });
  }

  const month = req.nextUrl.searchParams.get('month') ?? firstOfMonth(new Date().toISOString().slice(0, 10));

  let repos;
  try {
    repos = getRepos();
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }

  try {
    const settings = await repos.businessSettingsRepo.findByStoreAndMonth(parsed.data.storeId, month);
    return NextResponse.json({ success: true, month, settings });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 });
  }

  const parsed = businessSettingsUpsertSchema.safeParse(body);
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
    const settings = await repos.businessSettingsRepo.upsert(parsed.data);
    return NextResponse.json({ success: true, settings });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
