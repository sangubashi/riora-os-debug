/**
 * GET /api/cron/dashboard-aggregator(MD-1: DashboardAggregator自動実行)
 *
 * Vercel Cron(vercel.json crons)から毎日呼ばれる。runDashboardAggregator()
 * (src/lib/dashboard/DashboardAggregator.ts・計算式は変更しない)を実行し、
 * brain_dashboard_dailyへ当日分のスナップショットをUPSERTする。
 *
 * 認証: Vercel Cronはリクエストに `Authorization: Bearer ${CRON_SECRET}` を付与する
 * (CRON_SECRET環境変数が設定されている場合)。本ルートはCRON_SECRETが設定されている場合のみ
 * 検証する(未設定環境=ローカル開発では検証をスキップする)。
 *
 * 対象店舗: 現状DEMO_STORE_ID固定(v2.0方針「2店舗目が決まった月に初出」・他のnightly系
 * バッチ/スクリプトと同じ運用)。複数店舗対応時はstore一覧をループする呼び出し側に拡張する。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos } from '../../../lib/repos';
import { runDashboardAggregator } from '../../../../src/lib/dashboard/DashboardAggregator';
import { DEMO_STORE_ID } from '../../../../src/lib/constants';

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // ローカル開発等、CRON_SECRET未設定環境では検証をスキップ
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 });
  }

  let repos;
  try {
    repos = getRepos();
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }

  const snapshotDate = new Date().toISOString().slice(0, 10);

  try {
    const result = await runDashboardAggregator({ storeId: DEMO_STORE_ID, snapshotDate }, repos);
    return NextResponse.json({ success: true, storeId: DEMO_STORE_ID, snapshotDate, result });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
