import { supabaseAdmin as db } from "./supabaseAdminClient";
import { assertAdminAccess, AuthContext } from "./accessControl";
import { getAdminStrategy, getAdminStrategyLabel, buildAdminStrategyCommentary } from "./adminControl";

export interface AdminDashboardSummary {
  roleLabel: string;
  strategy: string;
  strategyComment: string;
  todaySales: number;
  monthSales: number;
  landingForecast: number;
  grossProfitRate: number;
  rentRate: number;
  breakEvenSales: number;
  utilizationRate: number;
  repeatRate: number;
  averageTicket: number;
  averageLTV: number;
  customerCount: number;
  activeCustomers30d: number;
  aiCommentary: string;
  updatedAt: string;
}

function toNumber(value: unknown): number {
  return typeof value === "number" ? value : typeof value === "string" ? parseFloat(value) || 0 : 0;
}

export async function fetchAdminDashboardSummary(auth: AuthContext): Promise<AdminDashboardSummary> {
  assertAdminAccess(auth);

  const { data, error } = await db
    .from("customers_secure")
    .select("ltv, visit_count, last_visit_at");

  if (error) {
    throw new Error(`管理ダッシュボード集計に失敗しました: ${error.message}`);
  }

  const rows = data ?? [];
  const totalCustomers = rows.length;
  const totalLtvNum = rows.reduce((sum, row) => sum + toNumber((row as any).ltv), 0);
  const totalVisitsNum = rows.reduce((sum, row) => sum + toNumber((row as any).visit_count), 0) || 1;
  const repeatCountNum = rows.filter((row) => toNumber((row as any).visit_count) > 1).length;
  const active30dNum = rows.filter((row) => {
    const lastVisit = (row as any).last_visit_at;
    if (!lastVisit) return false;
    return new Date(lastVisit).getTime() >= Date.now() - 30 * 24 * 60 * 60 * 1000;
  }).length;
  const activeTodayNum = rows.filter((row) => {
    const lastVisit = (row as any).last_visit_at;
    if (!lastVisit) return false;
    return new Date(lastVisit).toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10);
  }).length;
  const monthActiveNum = rows.filter((row) => {
    const lastVisit = (row as any).last_visit_at;
    if (!lastVisit) return false;
    const visitMonth = new Date(lastVisit).toISOString().slice(0, 7);
    return visitMonth === new Date().toISOString().slice(0, 7);
  }).length;

  const averageTicket = totalVisitsNum > 0 ? totalLtvNum / totalVisitsNum : 0;
  const todaySales = averageTicket * activeTodayNum;
  const monthSales = averageTicket * monthActiveNum;
  const landingForecast = monthSales * 1.08;
  const grossProfitRate = 0.65;
  const rentRate = 0.25;
  const breakEvenSales = rentRate > 0 ? monthSales / (1 - rentRate) : monthSales;
  const utilizationRate = totalCustomers > 0 ? active30dNum / totalCustomers : 0;
  const repeatRate = totalCustomers > 0 ? repeatCountNum / totalCustomers : 0;
  const averageLTV = totalCustomers > 0 ? totalLtvNum / totalCustomers : 0;

  const strategy = getAdminStrategy();
  const strategyLabel = getAdminStrategyLabel(strategy);
  const strategyComment = buildAdminStrategyCommentary();

  const aiCommentary = `管理者（ADMIN）ダッシュボード: ${strategyLabel}。本日の推定売上は ¥${Math.round(todaySales).toLocaleString()}、月間見込みは ¥${Math.round(landingForecast).toLocaleString()} です。リピート率は ${(repeatRate * 100).toFixed(1)}%、30日稼働率は ${(utilizationRate * 100).toFixed(1)}%です。`; 

  return {
    roleLabel: "管理者（ADMIN）",
    strategy: strategyLabel,
    strategyComment,
    todaySales,
    monthSales,
    landingForecast,
    grossProfitRate,
    rentRate,
    breakEvenSales,
    utilizationRate,
    repeatRate,
    averageTicket,
    averageLTV,
    customerCount: totalCustomers,
    activeCustomers30d: active30dNum,
    aiCommentary,
    updatedAt: new Date().toISOString(),
  };
}

export async function exportCustomerSecureDataCsv(auth: AuthContext): Promise<string> {
  assertAdminAccess(auth);

  const { data, error } = await db
    .from("customers_secure")
    .select("hash_id, birthday, skin_type, risk_score, ltv, visit_count, customer_type, is_vip, last_visit_at, notes");

  if (error) {
    throw new Error(`エクスポートに失敗しました: ${error.message}`);
  }

  const header = [
    "hash_id",
    "birthday",
    "skin_type",
    "risk_score",
    "ltv",
    "visit_count",
    "customer_type",
    "is_vip",
    "last_visit_at",
    "notes",
  ];

  const csvRows = [header.join(",")];
  data?.forEach((row) => {
    csvRows.push(
      [
        row.hash_id,
        row.birthday ?? "",
        row.skin_type ?? "",
        row.risk_score ?? 0,
        row.ltv ?? 0,
        row.visit_count ?? 0,
        row.customer_type ?? "",
        row.is_vip ? "TRUE" : "FALSE",
        row.last_visit_at ?? "",
        (row.notes ?? "").replace(/\r?\n/g, " ").replace(/,/g, "、"),
      ].join(",")
    );
  });

  return csvRows.join("\n");
}
