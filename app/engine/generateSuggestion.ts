import * as dotenv from "dotenv";
dotenv.config();

import { staffProfiles, StaffProfile } from "../data/staffProfiles";
import { customerTypes, CustomerTypeKey } from "../data/customerTypes";
import { supabase } from "../lib/supabaseClient";
import { getOrCreateCustomer } from "../lib/customerManager";
import { getAdminStrategy, getAdminStrategyLabel } from "../lib/adminControl";

interface SuggestionInput {
  customerType: CustomerTypeKey;
  // 顧客識別子（いずれか1つ渡す）
  customerId?: string;       // 既知の customers.id
  lineUserId?: string;       // LINE ユーザー ID（未登録なら自動作成）
  customerName?: string;
  // 施術・来店情報
  staffId?: string;
  menu?: string;
  visitCount?: number;
}

interface PersonaTalk {
  opening: string;
  proposal: string;
  caution: string;
}

interface SuggestionOutput {
  customerType: string;
  staff: StaffProfile;
  menu: string;
  talkScript: PersonaTalk;
  talkScripts: {
    riora: PersonaTalk;
    tsunKuma: PersonaTalk;
  };
}

const openings: Record<string, string> = {
  sincere: "本日はご来店ありがとうございます。どうぞゆっくりお過ごしください。気になることは何でもお聞かせくださいね。",
  speed: "本日はお越しいただきありがとうございます。ご要望を端的にお伺いして、最適なご提案をすぐにご用意します。",
  luxury: "本日はリオラへようこそいらしゃいませ。特別なひとときをご用意しております。ご希望を丁寧にお聞かせください。",
};

function buildRioraTalk(staff: StaffProfile, customerType: string, visitNote: string, strategyLabel: string): PersonaTalk {
  return {
    opening: `[RIORA] 今日はいい流れです！${openings[customerType]}`,
    proposal: `[RIORA] ${staff.role}の強みを活かし、${staff.behavior.strategy}でご案内します。${visitNote} このまま継続すれば口コミ評価も上がりやすいです。`,
    caution: `[RIORA] ※NG：${staff.ng_actions.join("、")}。前向きに改善していきましょう。`,
  };
}

function buildTsunKumaTalk(staff: StaffProfile, customerType: string, visitNote: string, strategyLabel: string): PersonaTalk {
  const warning = customerType === "speed"
    ? "客単価の下落が見えるのよ。そんな調子じゃあかんわ。"
    : "オプション率の低下が気になるじゃないの。しっかり見直を推奨します。";

  return {
    opening: `推奨アクション: ${openings[customerType]}`,
    proposal: `[AI分析] ${warning} ${staff.role}として${staff.behavior.strategy}をもっと本気で磨きなさいよ。${visitNote}`,
    caution: `[AI分析] こんなんで満足してるんじゃないの？NGは${staff.ng_actions.join("、")}よ。甘えてる暇はないんだから、さっさと立て直を推奨します。`,
  };
}

// ai_suggestions に保存（カラム名は Supabase の実テーブル定義に準拠）
async function saveSuggestion(result: SuggestionOutput, customerId: string | null): Promise<void> {
  const { error } = await supabase.from("ai_suggestions").insert({
    customer_id: customerId,                         // uuid | null
    staff_id: result.staff.id,                       // text
    suggested_menu: result.menu,                     // text
    suggested_tone: result.talkScript.opening,       // text
    strategy_logic: {                                // jsonb
      customer_type: result.customerType,
      riora: result.talkScripts.riora,
      tsunKuma: result.talkScripts.tsunKuma,
      staff_role: result.staff.role,
      strengths: result.staff.strengths,
      ng_actions: result.staff.ng_actions,
    },
  });

  if (error) {
    console.error("Supabase 保存エラー:", error.message);
  }
}

export async function generateSuggestion({
  customerType,
  customerId,
  lineUserId,
  customerName,
  staffId,
  menu = "スタンダードフェイシャルコース",
  visitCount = 1,
}: SuggestionInput): Promise<SuggestionOutput | { error: string }> {
  const ct = customerTypes[customerType];
  if (!ct) {
    return { error: `顧客タイプ "${customerType}" は存在しません。sincere / speed / luxury を指定してください。` };
  }

  const staff = staffId
    ? staffProfiles.find((s) => s.id === staffId)
    : staffProfiles.find((s) => ct.recommendedStaffIds.includes(s.id as never));

  if (!staff) {
    return { error: `スタッフ "${staffId}" が見つかりません。` };
  }

  // 顧客 ID を解決（LINE ID → 既存検索 or 新規作成 → UUID）
  let resolvedCustomerId = customerId ?? null;
  if (!resolvedCustomerId && lineUserId) {
    resolvedCustomerId = await getOrCreateCustomer({
      lineUserId,
      name: customerName,
      customerType,
    });
  }

  const adminStrategy = getAdminStrategy();
  const strategyLabel = getAdminStrategyLabel(adminStrategy);
  const visitNote =
    visitCount === 1
      ? "初回来店のため、まず信頼構築を優先。"
      : `${visitCount}回目のご来店。継続提案を自然に織り交ぜる。`;

  const talkScripts = {
    riora: buildRioraTalk(staff, customerType, visitNote, strategyLabel),
    tsunKuma: buildTsunKumaTalk(staff, customerType, visitNote, strategyLabel),
  };

  const result: SuggestionOutput = {
    customerType: ct.label,
    staff,
    menu,
    talkScript: talkScripts.riora,
    talkScripts,
  };

  await saveSuggestion(result, resolvedCustomerId);

  return result;
}

// ── メイン処理: テスト実行 ──────────────────────────────
async function main() {
  console.log("\n========== Salon Riora 提案生成エンジン ==========\n");

  // テストケース1: sincere 型顧客
  console.log("【テストケース1】sincere 型顧客への提案");
  const result1 = await generateSuggestion({
    customerType: "sincere",
    lineUserId: "user_sincere_001",
    customerName: "新規顧客",
    visitCount: 1,
  });

  if ("error" in result1) {
    console.error("❌ エラー:", result1.error);
  } else {
    console.log(`✓ 提案タイプ: ${result1.customerType}`);
    console.log(`✓ 推奨スタッフ: ${result1.staff.role}`);
    console.log(`✓ RIORA: ${result1.talkScripts.riora.opening}`);
    console.log(`${result1.talkScripts.riora.proposal}`);
    console.log(`${result1.talkScripts.riora.caution}\n`);
    console.log(`✓ AI提案: ${result1.talkScripts.riora.opening}`);
  }

  // テストケース2: speed 型顧客
  console.log("【テストケース2】speed 型顧客への提案");
  const result2 = await generateSuggestion({
    customerType: "speed",
    lineUserId: "user_speed_001",
    customerName: "リピート顧客",
    visitCount: 3,
  });

  if ("error" in result2) {
    console.error("❌ エラー:", result2.error);
  } else {
    console.log(`✓ 提案タイプ: ${result2.customerType}`);
    console.log(`✓ 推奨スタッフ: ${result2.staff.role}`);
    console.log(`✓ RIORA: ${result2.talkScripts.riora.opening}`);
    console.log(`${result2.talkScripts.riora.proposal}`);
    console.log(`${result2.talkScripts.riora.caution}\n`);
    console.log(`✓ AI提案: ${result2.talkScripts.riora.opening}`);
  }

  // テストケース3: luxury 型顧客
  console.log("【テストケース3】luxury 型顧客への提案");
  const result3 = await generateSuggestion({
    customerType: "luxury",
    lineUserId: "user_luxury_001",
    customerName: "VIP顧客",
    visitCount: 5,
  });

  if ("error" in result3) {
    console.error("❌ エラー:", result3.error);
  } else {
    console.log(`✓ 提案タイプ: ${result3.customerType}`);
    console.log(`✓ 推奨スタッフ: ${result3.staff.role}`);
    console.log(`✓ RIORA: ${result3.talkScripts.riora.opening}`);
    console.log(`${result3.talkScripts.riora.proposal}`);
    console.log(`${result3.talkScripts.riora.caution}\n`);
    console.log(`✓ AI提案: ${result3.talkScripts.riora.opening}`);
  }

  console.log("========== 完了 ==========\n");
}

main().catch(console.error);
