/**
 * GET /api/me/monthly-stats
 *
 * 「わたしタブ」用API。ログイン中のスタッフ本人の実績のみを、
 * 今月 vs 先月の差分（事実の増減）として返す。他スタッフとの比較・
 * ランキング・順位は一切含まない（Riora OS v1.0 再設計書 準拠）。
 *
 * 返却フィールド:
 *   staffId            brain_staff.id（PHASE MYPAGE-STAFF-VARIANT: My Page側の
 *                      スタッフ別出し分けは氏名文字列ではなく必ずこのIDで判定する）
 *   nominationDiff     今月の指名来店数 − 先月の指名来店数
 *   repeatRateDiff     今月のリピート率(%) − 先月のリピート率(%)
 *   visitCountDiff     今月の来店数 − 先月の来店数
 *   retailSalesDiff    今月の店販売上(brain_visits.retail_amount合計) − 先月の店販売上
 *                      (今月・先月とも来店記録が1件も無い場合はnull。「計測中」表示に使う)
 *   salesDiff          今月の合計売上(施術+店販) − 先月の合計売上(PHASE MYPAGE-DEMO-CLEANUP)。
 *                      「今月のひとこと」の実データ判定用。
 *   avgSpendDiff       客単価(合計売上÷来店件数)の今月−先月差分。いずれかの月の来店が
 *                      0件ならnull(架空の客単価改善を作らない)。「今月のひとこと」用。
 *   nomination.rate    今月の指名率(%) = 今月の指名来店数 / 今月の来店数。
 *                      今月の来店記録が0件の場合はnull(架空の割合を作らない)。
 *   weekly             今週 vs 先週(月曜始まりJST)の差分（PHASE MYPAGE-WEEKLY-PRAISE）。
 *                      「先週のよかったところ」用。nominationDiff/repeatRateDiffは月次と
 *                      同じ定義の週次版。retailCountDiffは店販売上(円)ではなく
 *                      「店販ありの来店件数」の差分。salesDiffは施術+店販の合計売上差分。
 *                      avgSpendDiffは客単価(売上÷来店件数)差分(いずれか一方の来店が
 *                      0件ならnull)。
 *   lastMonthSummary   「先月の実績」カード(PHASE MYPAGE-LASTMONTH-SUMMARY)用。
 *                      sales(施術+店販の合計売上)・visitCount(ユニーク来店人数、行数では
 *                      ない)・avgSpend(sales÷visitCount)・nominationRate(%)・
 *                      repeatRate(%)・retailSales(店販売上。PHASE MYPAGE-METRICS-RETAIL
 *                      で追加)。
 *                      先月の来店が0件の場合はvisitCount=0/retailSales=0、他は全てnull。
 *
 *   PHASE STAFF-LTV-CLEANUP(2026-08-02): 以前はlastMonthSummary.ltv(このスタッフが
 *   先月担当した顧客のLTV平均値)も返していたが、My Page表示からは既に外れておりフロント
 *   エンドのどこからも参照されていなかったため、算出ロジック(brain_visits/
 *   brain_subscriptionsからのLTV計算)とレスポンスフィールドを削除した。管理者ダッシュ
 *   ボードのStaffAnalyticsEngine/CustomerAssetEngine側のLTV機能とは独立した実装のため、
 *   この削除はそれらに影響しない。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '../../../lib/repos';
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest';

const STORE_ID = '00000000-0000-0000-0000-000000000001';

function monthStart(offsetMonths: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offsetMonths);
  return d.toISOString().split('T')[0];
}

/** 今週(月曜)開始日をJST基準で返す。offsetWeeks=-1で先週の月曜。 */
function weekStart(offsetWeeks: number): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const dow = jst.getUTCDay(); // 0=日,1=月...6=土
  const daysSinceMonday = (dow + 6) % 7;
  jst.setUTCDate(jst.getUTCDate() - daysSinceMonday + offsetWeeks * 7);
  return jst.toISOString().split('T')[0];
}

function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

function summarizeWeekly(rows: VisitRow[]) {
  const nominationCount = rows.filter(r => r.is_nomination).length;
  const retailCount     = rows.filter(r => (r.retail_amount ?? 0) > 0).length;
  const visitCount      = rows.length;
  const repeatCount     = rows.filter(r => (r.visit_count_at ?? 0) > 1).length;
  const repeatRate      = visitCount > 0 ? Math.round((repeatCount / visitCount) * 100) : 0;
  const totalSales      = rows.reduce((sum, r) => sum + (r.treatment_amount ?? 0) + (r.retail_amount ?? 0), 0);
  return { nominationCount, retailCount, repeatRate, visitCount, totalSales };
}

interface VisitRow {
  visit_date:       string;
  is_nomination:    boolean | null;
  visit_count_at:   number | null;
  retail_amount:    number | null;
  treatment_amount: number | null;
  customer_id:      string | null;
}

function summarize(rows: VisitRow[]) {
  const visitCount      = rows.length;
  const nominationCount = rows.filter(r => r.is_nomination).length;
  const repeatCount     = rows.filter(r => (r.visit_count_at ?? 0) > 1).length;
  const repeatRate      = visitCount > 0 ? Math.round((repeatCount / visitCount) * 100) : 0;
  const retailSales     = rows.reduce((sum, r) => sum + (r.retail_amount ?? 0), 0);
  const totalSales      = rows.reduce((sum, r) => sum + (r.treatment_amount ?? 0) + (r.retail_amount ?? 0), 0);
  return { visitCount, nominationCount, repeatRate, retailSales, totalSales };
}

/** 増減率(%)。先月実績が0の場合は算出不能のためnull(架空の割合を作らない)。 */
function pctChange(diff: number, lastMonthValue: number): number | null {
  if (lastMonthValue === 0) return null;
  return Math.round((diff / lastMonthValue) * 1000) / 10;
}

export async function GET(req: NextRequest) {
  const staff = await extractStaffFromRequest(req);
  if (!staff) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // 管理者(owner)アカウントはbrain_staff行を持たずstaffBrainId=nullのため、
  // staff_idクエリを実行すると常に0件になってしまう(PHASE MYPAGE-AUDIT-1で特定)。
  // 誤った0表示を返す前にここで弾く。
  if (staff.isAdmin || !staff.staffBrainId) {
    return NextResponse.json(
      { error: 'admin_not_supported', message: '管理者アカウントではご利用いただけません。スタッフアカウントでログインしてください。' },
      { status: 400 }
    );
  }

  try {
    const supabase = getServiceClient();

    const thisMonthStart = monthStart(0);
    const lastMonthStart = monthStart(-1);
    // 「先月」の終端は「今月開始日の前日」
    const lastMonthEnd = new Date(thisMonthStart);
    lastMonthEnd.setDate(lastMonthEnd.getDate() - 1);
    const lastMonthEndStr = lastMonthEnd.toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('brain_visits')
      .select('visit_date, is_nomination, visit_count_at, retail_amount, treatment_amount, customer_id')
      .eq('store_id', STORE_ID)
      .eq('staff_id', staff.staffBrainId)
      .gte('visit_date', lastMonthStart)
      .is('deleted_at', null);

    if (error) throw error;

    const rows = (data ?? []) as VisitRow[];
    const thisMonthRows = rows.filter(r => r.visit_date >= thisMonthStart);
    const lastMonthRows = rows.filter(r => r.visit_date >= lastMonthStart && r.visit_date <= lastMonthEndStr);

    const thisMonth = summarize(thisMonthRows);
    const lastMonth = summarize(lastMonthRows);

    // 今月・先月とも来店記録が無い場合は比較の土台が無いため、0円差分ではなくnull
    // (「計測中」表示に使う)。どちらか一方にでも来店記録があれば実際の差分を返す。
    const hasVisitData     = thisMonthRows.length > 0 || lastMonthRows.length > 0;
    const retailSalesDiff  = hasVisitData ? thisMonth.retailSales - lastMonth.retailSales : null;

    const nominationDiff = thisMonth.nominationCount - lastMonth.nominationCount;
    const repeatRateDiff = thisMonth.repeatRate - lastMonth.repeatRate;
    const visitCountDiff = thisMonth.visitCount - lastMonth.visitCount;
    const salesDiff       = thisMonth.totalSales - lastMonth.totalSales;

    // 客単価(合計売上÷来店件数、行数ベース)の今月−先月差分。weeklyのavgSpendDiffと
    // 同じ定義(行数ベース)で揃える(PHASE MYPAGE-DEMO-CLEANUP、「今月のひとこと」用)。
    const thisMonthAvgSpendRaw = thisMonth.visitCount > 0 ? thisMonth.totalSales / thisMonth.visitCount : null;
    const lastMonthAvgSpendRaw = lastMonth.visitCount > 0 ? lastMonth.totalSales / lastMonth.visitCount : null;
    const monthlyAvgSpendDiff = (thisMonthAvgSpendRaw !== null && lastMonthAvgSpendRaw !== null)
      ? Math.round(thisMonthAvgSpendRaw - lastMonthAvgSpendRaw)
      : null;

    // 今月の指名率(%)。今月の来店記録が0件なら算出不能のためnull(架空の割合を作らない)。
    const nominationRate = thisMonth.visitCount > 0
      ? Math.round((thisMonth.nominationCount / thisMonth.visitCount) * 100)
      : null;

    // ── 週次(今週 vs 先週、月曜始まりJST) ──────────────────────────────
    const thisWeekStart = weekStart(0);
    const lastWeekStart = weekStart(-1);
    const lastWeekEnd   = addDaysStr(thisWeekStart, -1);

    const thisWeekRows = rows.filter(r => r.visit_date >= thisWeekStart);
    const lastWeekRows = rows.filter(r => r.visit_date >= lastWeekStart && r.visit_date <= lastWeekEnd);
    const thisWeek = summarizeWeekly(thisWeekRows);
    const lastWeek = summarizeWeekly(lastWeekRows);

    const thisWeekAvgSpend = thisWeek.visitCount > 0 ? thisWeek.totalSales / thisWeek.visitCount : null;
    const lastWeekAvgSpend = lastWeek.visitCount > 0 ? lastWeek.totalSales / lastWeek.visitCount : null;
    const avgSpendDiff = (thisWeekAvgSpend !== null && lastWeekAvgSpend !== null)
      ? Math.round(thisWeekAvgSpend - lastWeekAvgSpend)
      : null;

    // ── 「先月の実績」カード(PHASE MYPAGE-LASTMONTH-SUMMARY) ──────────────
    // 来店人数はユニーク顧客数(行数ではない。StaffAnalyticsEngineのSA-2と同じ定義)。
    const lastMonthCustomerIds = Array.from(new Set(
      lastMonthRows.map(r => r.customer_id).filter((id): id is string => !!id)
    ));
    const lastMonthVisitorCount = lastMonthCustomerIds.length;
    const lastMonthAvgSpend = lastMonthVisitorCount > 0
      ? Math.round(lastMonth.totalSales / lastMonthVisitorCount)
      : null;
    const lastMonthNominationRate = lastMonthRows.length > 0
      ? Math.round((lastMonth.nominationCount / lastMonthRows.length) * 100)
      : null;

    return NextResponse.json({
      staffId: staff.staffBrainId,
      nominationDiff,
      repeatRateDiff,
      visitCountDiff,
      retailSalesDiff,
      salesDiff,
      avgSpendDiff: monthlyAvgSpendDiff,
      // タップ時の詳細モーダル用(今月・先月の実数)。既に上で計算済みの値を再利用するのみ
      // (新しい集計ロジックは追加しない)。
      nomination: {
        thisMonth: thisMonth.nominationCount,
        lastMonth: lastMonth.nominationCount,
        diff:      nominationDiff,
        pctChange: pctChange(nominationDiff, lastMonth.nominationCount),
        rate:      nominationRate,
      },
      repeatRate: {
        thisMonth: thisMonth.repeatRate,
        lastMonth: lastMonth.repeatRate,
        diff:      repeatRateDiff,
        pctChange: pctChange(repeatRateDiff, lastMonth.repeatRate),
      },
      visitCount: {
        thisMonth: thisMonth.visitCount,
        lastMonth: lastMonth.visitCount,
        diff:      visitCountDiff,
        pctChange: pctChange(visitCountDiff, lastMonth.visitCount),
      },
      retailSales: hasVisitData ? {
        thisMonth: thisMonth.retailSales,
        lastMonth: lastMonth.retailSales,
        diff:      retailSalesDiff,
        pctChange: pctChange(retailSalesDiff ?? 0, lastMonth.retailSales),
      } : null,
      weekly: {
        nominationDiff:  thisWeek.nominationCount - lastWeek.nominationCount,
        retailCountDiff: thisWeek.retailCount     - lastWeek.retailCount,
        repeatRateDiff:  thisWeek.repeatRate       - lastWeek.repeatRate,
        salesDiff:       thisWeek.totalSales       - lastWeek.totalSales,
        avgSpendDiff,
      },
      lastMonthSummary: {
        sales:          lastMonth.totalSales,
        visitCount:     lastMonthVisitorCount,
        avgSpend:       lastMonthAvgSpend,
        nominationRate: lastMonthNominationRate,
        repeatRate:     lastMonthRows.length > 0 ? lastMonth.repeatRate : null,
        retailSales:    lastMonth.retailSales,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
