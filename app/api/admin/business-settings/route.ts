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
 *   当月行が未存在の場合は直前月の設定をフォールバック返却する(月跨ぎ固定費永続化)。
 * POST: (store_id, month)へUPSERTする。変更前後をbrain_ops_logsへ記録する(監査)。
 *   損益分岐点・利益予測の計算式はDashboardAggregator側にあり、
 *   本ルートは入力データの保存のみを行う(計算しない)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos } from '../../../lib/repos';
import { storeIdQuerySchema } from '../../_schemas/query';
import { businessSettingsUpsertSchema } from '../../_schemas/businessSettings';
import { toValidationErrorResponse } from '../../_schemas/common';

function firstOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function firstOfPreviousMonth(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
}

function hasValidFixedCosts(fixedCosts: Record<string, unknown> | null | undefined): boolean {
  if (!fixedCosts) return false;
  return Object.values(fixedCosts).some(v => typeof v === 'number' && Number.isFinite(v as number));
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
    // 当月行が未存在の場合、または fixed_costs が全 null(未入力)の場合は
    // 直前月の設定を引き継ぐ(月跨ぎ固定費永続化)。
    const exactSettings = await repos.businessSettingsRepo.findByStoreAndMonth(parsed.data.storeId, month);
    const settings = hasValidFixedCosts(exactSettings?.fixedCosts)
      ? exactSettings
      : (await repos.businessSettingsRepo.findLatestBeforeOrAt(
          parsed.data.storeId, firstOfPreviousMonth(month)
        )) ?? exactSettings;
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
    const before = await repos.businessSettingsRepo.findByStoreAndMonth(
      parsed.data.storeId,
      parsed.data.month,
    );
    const settings = await repos.businessSettingsRepo.upsert(parsed.data);

    // 変更前後をbrain_ops_logsへ記録する(設計書§監査)。
    await repos.opsLogRepo.insert({
      storeId: parsed.data.storeId,
      kind: 'business_settings_update',
      actorId: null,
      detail: {
        month: parsed.data.month,
        before: before
          ? { fixedCosts: before.fixedCosts, variableCostRate: before.variableCostRate, salesTarget: before.salesTarget }
          : null,
        after: { fixedCosts: settings.fixedCosts, variableCostRate: settings.variableCostRate, salesTarget: settings.salesTarget },
      },
    });

    return NextResponse.json({ success: true, settings });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
