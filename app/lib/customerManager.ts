import { supabase } from "./supabaseClient";
import { supabaseAdmin } from "./supabaseAdminClient";
import { generateHashId } from "./hash";

// 書き込みはサービスロール（RLSバイパス）、読み取りは anon で行う
const db = supabaseAdmin;

// ── 型定義 ────────────────────────────────────────────────
export interface PiiInput {
  phone: string;
  lastNameKana?: string;
}

export interface SecureInput {
  birthday?: string;                 // "YYYY-MM-DD"
  skinType?: SkinType;
  visitCount?: number;
  ltv?: number;
  salesAmount?: number;              // 今回売上（LTVに加算）
  customerType?: CustomerType;
  lastVisitAt?: string;
  notes?: string;
}

export type SkinType = "dry" | "oily" | "combination" | "sensitive" | "normal";
export type CustomerType = "sincere" | "speed" | "luxury";

export interface SecureProfile {
  hashId: string;
  birthday: string | null;
  skinType: SkinType | null;
  riskScore: number;
  ltv: number;
  visitCount: number;
  customerType: CustomerType | null;
  isVip: boolean;
  lastVisitAt: string | null;
  notes: string | null;
}

// ── 差分マージ（既存データを上書きしない） ────────────────
function mergeSecure(
  existing: Record<string, unknown> | null,
  input: SecureInput
): Record<string, unknown> {
  const ex = existing ?? {};

  // 来店回数: 新データが多ければ新データを採用
  const newVisitCount = Math.max(
    (ex.visit_count as number) ?? 0,
    input.visitCount ?? 0
  );

  // LTV: 今回売上を加算、またはCSVの値が大きければ採用
  const baseLtv = (ex.ltv as number) ?? 0;
  const newLtv = input.salesAmount
    ? baseLtv + input.salesAmount
    : Math.max(baseLtv, input.ltv ?? 0);

  // 最終来店日: より新しい日付を採用
  const existingVisit = (ex.last_visit_at as string) ?? "";
  const inputVisit = input.lastVisitAt ?? "";
  const newLastVisit =
    inputVisit > existingVisit ? inputVisit : existingVisit || new Date().toISOString();

  return {
    // 一度設定されたら上書きしないフィールド
    birthday:      (ex.birthday as string) || input.birthday || null,
    skin_type:     (ex.skin_type as string) || input.skinType || null,
    customer_type: (ex.customer_type as string) || input.customerType || null,
    notes:         input.notes || (ex.notes as string) || null,
    // 常に最新値を採用するフィールド
    visit_count:   newVisitCount,
    ltv:           newLtv,
    last_visit_at: newLastVisit,
    is_vip:        (ex.is_vip as boolean) || newVisitCount >= 5,
  };
}

// ── コア: 顧客を差分 Upsert（hash_id を返す） ────────────
export async function upsertCustomer(
  pii: PiiInput,
  secure: SecureInput = {}
): Promise<string> {
  const hashId = generateHashId(pii.phone);

  // 1. customers_pii: 姓カナのみ（既存があれば上書きしない）
  const { data: existingPii, error: piiSelectErr } = await db
    .from("customers_pii")
    .select("last_name_kana")
    .eq("hash_id", hashId)
    .maybeSingle();

  if (piiSelectErr && !piiSelectErr.message.includes("No rows")) {
    throw new Error(`customers_pii 取得エラー: ${piiSelectErr.message}`);
  }

  const { error: piiErr } = await db.from("customers_pii").upsert(
    {
      hash_id: hashId,
      last_name_kana: existingPii?.last_name_kana || pii.lastNameKana || null,
    },
    { onConflict: "hash_id" }
  );
  if (piiErr) throw new Error(`customers_pii 保存エラー: ${piiErr.message}`);

  // 2. customers_secure: 差分マージで更新
  const { data: existingSecure, error: secSelectErr } = await db
    .from("customers_secure")
    .select("*")
    .eq("hash_id", hashId)
    .maybeSingle();

  if (secSelectErr && !secSelectErr.message.includes("No rows")) {
    throw new Error(`customers_secure 取得エラー: ${secSelectErr.message}`);
  }

  const merged = mergeSecure(existingSecure, secure);

  const { error: secErr } = await db.from("customers_secure").upsert(
    { hash_id: hashId, ...merged },
    { onConflict: "hash_id" }
  );
  if (secErr) throw new Error(`customers_secure 保存エラー: ${secErr.message}`);

  return hashId;
}

// ── AI プロンプト用: PII なしプロフィールを取得 ───────────
export async function getSecureProfile(hashId: string): Promise<SecureProfile | null> {
  const { data, error } = await db
    .from("customers_secure")
    .select("*")
    .eq("hash_id", hashId)
    .single();

  if (error || !data) return null;

  return {
    hashId:       data.hash_id,
    birthday:     data.birthday,
    skinType:     data.skin_type,
    riskScore:    data.risk_score ?? 0,
    ltv:          data.ltv ?? 0,
    visitCount:   data.visit_count ?? 0,
    customerType: data.customer_type,
    isVip:        data.is_vip ?? false,
    lastVisitAt:  data.last_visit_at,
    notes:        data.notes,
  };
}

// ── 複数 hash_id のプロフィールを一括取得 ─────────────────
export async function getSecureProfiles(hashIds: string[]): Promise<SecureProfile[]> {
  if (hashIds.length === 0) return [];

  const { data, error } = await db
    .from("customers_secure")
    .select("*")
    .in("hash_id", hashIds);

  if (error || !data) return [];

  return data.map((d) => ({
    hashId:       d.hash_id,
    birthday:     d.birthday,
    skinType:     d.skin_type,
    riskScore:    d.risk_score ?? 0,
    ltv:          d.ltv ?? 0,
    visitCount:   d.visit_count ?? 0,
    customerType: d.customer_type,
    isVip:        d.is_vip ?? false,
    lastVisitAt:  d.last_visit_at,
    notes:        d.notes,
  }));
}

// ── LINE user_id と hash_id を紐付け ─────────────────────
export async function linkLineUser(hashId: string, lineUserId: string): Promise<void> {
  const { error } = await db.from("line_logs").insert({
    customer_hash_id: hashId,
    line_user_id: lineUserId,
    message_type: "text",
    direction: "inbound",
    content: { event: "link" },
  });
  if (error) console.error("LINE 紐付けエラー:", error.message);
}

// ── 来店記録（インクリメント + VIP 自動判定） ─────────────
export async function recordVisit(hashId: string, salesAmount: number = 0): Promise<void> {
  await upsertCustomer({ phone: "" }, { salesAmount });
  // phone が空の場合は hash_id を直接使って更新
  const { data } = await db
    .from("customers_secure")
    .select("visit_count, ltv")
    .eq("hash_id", hashId)
    .single();

  const newCount = (data?.visit_count ?? 0) + 1;
  const newLtv   = (data?.ltv ?? 0) + salesAmount;

  await db.from("customers_secure").update({
    visit_count:   newCount,
    ltv:           newLtv,
    last_visit_at: new Date().toISOString(),
    is_vip:        newCount >= 5,
  }).eq("hash_id", hashId);
}

// ── LINE ユーザーから顧客を取得または作成 ─────────────────
export async function getOrCreateCustomer({
  lineUserId,
  name = "ゲスト",
  customerType = "sincere",
}: {
  lineUserId: string;
  name?: string;
  customerType?: CustomerType;
}): Promise<string> {
  // LINE ID から既存顧客を検索
  const { data: existingLog } = await db
    .from("line_logs")
    .select("customer_hash_id")
    .eq("line_user_id", lineUserId)
    .limit(1)
    .single();

  if (existingLog?.customer_hash_id) {
    return existingLog.customer_hash_id;
  }

  // 新規顧客を作成（LINE ID から仮の電話番号を生成）
  // フォーマット: 09 + LINE ID ハッシュの最初9桁（数字のみ）
  const crypto = require("crypto");
  const lineHash = crypto
    .createHash("sha256")
    .update(lineUserId)
    .digest("hex")
    .replace(/[^0-9]/g, "") // 16進数から数字のみ抽出
    .substring(0, 9);
  const tempPhone = `09${lineHash}`; // 09 + 9桁 = 11桁
  const hashId = await upsertCustomer(
    { phone: tempPhone, lastNameKana: name },
    { customerType }
  );

  // LINE ID を紐付け
  await linkLineUser(hashId, lineUserId);

  return hashId;
}
