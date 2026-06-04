import * as dotenv from "dotenv";
dotenv.config();

import { supabase } from "../app/lib/supabaseClient";

async function testInsert() {
  const testData = {
    customer_type: "ラグジュアリータイプ",
    staff_id: "kameyama",
    staff_name: "チーフトレーナー",
    menu: "プレミアムフェイシャルコース",
    talk_opening: "本日はリオラへようこそいらしゃいませ。特別なひとときをご用意しております。",
    talk_proposal: "チーフトレーナーの強みである「理論説明・美意識訴求」を活かし、理論＋納得形成でご案内します。",
    talk_caution: "※NG：専門用語多用、説明過多",
    created_at: new Date().toISOString(),
  };

  console.log("Supabase に接続中...");
  const { data, error } = await supabase
    .from("ai_suggestions")
    .insert(testData)
    .select();

  if (error) {
    console.error("❌ 保存失敗:", error.message);
    process.exit(1);
  }

  console.log("✅ 保存成功！");
  console.log(JSON.stringify(data, null, 2));
}

testInsert();
