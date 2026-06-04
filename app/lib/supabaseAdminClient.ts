import { createClient } from "@supabase/supabase-js";

// RLSをバイパスするサービスロールクライアント
// サーバー側処理（CSV インポート・シード・バッチ）専用
// クライアントサイドや API レスポンスには絶対に使わない
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey  = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !serviceKey || serviceKey === "ここにservice_roleキーを貼り付ける") {
  throw new Error(
    "SUPABASE_SERVICE_KEY が .env に設定されていません。\n" +
    "Supabase Dashboard → Settings → API → service_role キーを追加してください。"
  );
}

export const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false },
});
