import { createHash } from "crypto";

// 電話番号を正規化（ハイフン・スペース除去、国際番号を国内形式に変換）
export function normalizePhone(phone: string): string {
  return phone
    .replace(/-/g, "")
    .replace(/\s/g, "")
    .replace(/^\+81/, "0");
}

// 正規化済み電話番号 + シークレットで sha256 ハッシュを生成
export function generateHashId(phone: string): string {
  const secret = process.env.HASH_SECRET;
  if (!secret) throw new Error("HASH_SECRET が .env に設定されていません。");

  const normalized = normalizePhone(phone);
  if (!/^0\d{9,10}$/.test(normalized)) {
    throw new Error(`電話番号の形式が不正です: "${normalized}"`);
  }

  return createHash("sha256")
    .update(normalized + secret)
    .digest("hex");
}
