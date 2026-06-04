import * as dotenv from "dotenv";
dotenv.config();

import { fetchAdminDashboardSummary } from "../app/lib/adminDashboard";

async function main() {
  const auth = {
    role: "manager",
    twoFactorEnabled: true,
    staffId: "suzuki",
  };

  const summary = await fetchAdminDashboardSummary(auth);

  console.log("\n===== ADMIN ダッシュボード =====\n");
  console.log(`役割: ${summary.roleLabel}`);
  console.log(`管理者戦略: ${summary.strategy}`);
  console.log(`AIコメント: ${summary.strategyComment}`);
  console.log(`本日売上推定: ¥${Math.round(summary.todaySales).toLocaleString()}`);
  console.log(`今月売上: ¥${Math.round(summary.monthSales).toLocaleString()}`);
  console.log(`着地予測: ¥${Math.round(summary.landingForecast).toLocaleString()}`);
  console.log(`粗利率: ${(summary.grossProfitRate * 100).toFixed(1)}%`);
  console.log(`家賃率: ${(summary.rentRate * 100).toFixed(1)}%`);
  console.log(`損益分岐売上: ¥${Math.round(summary.breakEvenSales).toLocaleString()}`);
  console.log(`稼働率（30日）: ${(summary.utilizationRate * 100).toFixed(1)}%`);
  console.log(`リピート率: ${(summary.repeatRate * 100).toFixed(1)}%`);
  console.log(`客単価（推定）: ¥${Math.round(summary.averageTicket).toLocaleString()}`);
  console.log(`平均LTV: ¥${Math.round(summary.averageLTV).toLocaleString()}`);
  console.log(`顧客数: ${summary.customerCount}`);
  console.log(`AI分析コメント: ${summary.aiCommentary}`);
  console.log(`更新日時: ${summary.updatedAt}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
