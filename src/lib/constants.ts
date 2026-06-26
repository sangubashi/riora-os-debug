/**
 * constants.ts — DEMO_MODE運用の単一店舗ID
 *
 * 現状(DEMO_MODE=true)はマルチ店舗UIが無く、フロントから storeId を渡す手段が
 * 無いため、CSV Import Management(画面⑥)のAPI呼び出し・ルート双方がこれを既定値とする。
 * 複数店舗対応時はログイン中ユーザーのstore_idに置き換える。
 */
export const DEMO_STORE_ID = '00000000-0000-0000-0000-000000000001'
