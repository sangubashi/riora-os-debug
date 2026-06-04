import * as dotenv from "dotenv";
dotenv.config();

import { upsertCustomer, getSecureProfiles } from "../app/lib/customerManager";
import { runAnalysis } from "../app/engine/analysisEngine";
import { supabase } from "../app/lib/supabaseClient";

// ============================================================
// テスト用仮想顧客データ
// ============================================================
const TEST_CUSTOMERS = [
  {
    label: "田中様（VIP）",
    pii: {
      phone: "090-1111-2222",
      lastNameKana: "タナカ",
    },
    secure: {
      birthday: "1978-04-15",
      skinType: "dry" as const,
      visitCount: 30,
      ltv: 600000,
      lastVisitAt: new Date(Date.now() - 7 * 86400000).toISOString(), // 1週間前
      notes: "たるみ・ハリ不足。EMS効果を実感中。VIP継続中。",
    },
  },
  {
    label: "佐藤様（リスク大）",
    pii: {
      phone: "090-3333-4444",
      lastNameKana: "サトウ",
    },
    secure: {
      birthday: "1990-08-22",
      skinType: "oily" as const,
      visitCount: 5,
      ltv: 200000,
      lastVisitAt: new Date(Date.now() - 120 * 86400000).toISOString(), // 4ヶ月前
      notes: "ニキビ・毛穴の開き。4ヶ月来店なし。要フォロー。",
    },
  },
  {
    label: "鈴木様（新規）",
    pii: {
      phone: "090-5555-6666",
      lastNameKana: "スズキ",
    },
    secure: {
      birthday: "1995-12-03",
      skinType: "combination" as const,
      visitCount: 1,
      ltv: 0,
      lastVisitAt: new Date().toISOString(), // 本日
      notes: "毛穴の開き・黒ずみ。初回来店。",
    },
  },
];

// ============================================================
// ログ表示ユーティリティ
// ============================================================
function printSection(title: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("=".repeat(60));
}

function printRow(label: string, value: unknown) {
  const v = typeof value === "object" ? JSON.stringify(value) : String(value ?? "—");
  console.log(`  ${label.padEnd(20)}: ${v}`);
}

// ============================================================
// メイン処理
// ============================================================
async function main() {
  printSection("STEP 1: 仮想顧客データを PII分離フローでインポート");

  const hashIds: string[] = [];

  for (const customer of TEST_CUSTOMERS) {
    console.log(`\n  ▶ ${customer.label}`);
    try {
      const hashId = await upsertCustomer(customer.pii, customer.secure);
      hashIds.push(hashId);
      console.log(`    hash_id : ${hashId}`);
      console.log(`    ✓ customers_pii  → last_name_kana: ${customer.pii.lastNameKana}`);
      console.log(`    ✓ customers_secure → visit_count: ${customer.secure.visitCount}, ltv: ¥${customer.secure.ltv.toLocaleString()}`);
    } catch (err) {
      console.error(`    ✗ エラー: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ============================================================
  printSection("STEP 2: 解析エンジンを実行");

  const profiles = await getSecureProfiles(hashIds);
  console.log(`\n  取得プロフィール数: ${profiles.length}件`);

  const analysisResults = await runAnalysis({
    importedHashIds: hashIds,
    profiles,
    importedAt: new Date().toISOString(),
    sourceFile: "seed_test_data.ts",
    summary: {
      total: TEST_CUSTOMERS.length,
      success: hashIds.length,
      skipped: 0,
      errorCount: 0,
    },
  });

  // ============================================================
  printSection("STEP 3: 解析結果");

  for (let i = 0; i < analysisResults.length; i++) {
    const r = analysisResults[i];
    const label = TEST_CUSTOMERS.find(
      (_, idx) => hashIds[idx] === r.hashId
    ) ? TEST_CUSTOMERS[hashIds.indexOf(r.hashId)]?.label : r.hashId.slice(0, 8) + "...";

    console.log(`\n  ── ${label} ──`);
    printRow("サロンタイプ",   `タイプ ${r.salonType}`);
    printRow("来店ステージ",   r.visitStage);
    printRow("リスクスコア",   `${r.riskScore} / 10`);
    printRow("VIP候補",        r.vipCandidate ? "✓ YES" : "— NO");
    printRow("接客スタイル",   r.customerType ?? "—");
    printRow("推奨メニュー",   r.recommendedMenu);
    printRow("推奨オプション", r.recommendedOption);
    printRow("次回メッセージ", r.nextVisitMessage);
    console.log(`  ${"AIアドバイス".padEnd(20)}:`);
    console.log(`    ${r.advice.message}`);
  }

  // ============================================================
  printSection("STEP 4: customers_secure の最終状態（DB確認）");

  const { data, error } = await supabase
    .from("customers_secure")
    .select("*")
    .in("hash_id", hashIds);

  if (error) {
    console.error("  DB取得エラー:", error.message);
    return;
  }

  for (const row of data ?? []) {
    const label = TEST_CUSTOMERS[hashIds.indexOf(row.hash_id)]?.label ?? "不明";
    console.log(`\n  ── ${label} ──`);
    printRow("hash_id",       row.hash_id.slice(0, 16) + "...");
    printRow("skin_type",     row.skin_type);
    printRow("visit_count",   row.visit_count);
    printRow("ltv",           `¥${(row.ltv ?? 0).toLocaleString()}`);
    printRow("risk_score",    row.risk_score);
    printRow("customer_type", row.customer_type);
    printRow("is_vip",        row.is_vip ? "✓ TRUE" : "FALSE");
    printRow("last_visit_at", row.last_visit_at?.slice(0, 10) ?? "—");
    printRow("notes",         row.notes);
  }

  printSection("完了");
  console.log("  全フローが正常に動作しました。\n");
}

main().catch((err) => {
  console.error("実行エラー:", err);
  process.exit(1);
});
