-- ================================================================
-- 2026-07-20: 通知精度改善 — 社内利用者(スタッフ本人)除外フラグ
--
-- 背景: brain_customersにスタッフ本人の試用・検証購入記録(外舘裕子・鈴木雅子)が
-- 実顧客として存在しており、ホームケア補充前通知・離脱予兆通知(NT-4)に混入する
-- ことが判明した(docs/NOTIFICATION_INTERNAL_USER_EXCLUSION.md参照)。
--
-- 自動突合キー(email/phone/氏名)は信頼できないため(同ドキュメント1章)、
-- 手動フラグで管理する(line_user_ids.is_staffと同じ設計方針)。
--
-- 制約:
--   - 加算のみ(ADD COLUMN IF NOT EXISTS)。既存データへの破壊的変更なし。
--   - デフォルトfalseのため、本migration適用のみでは既存の通知挙動は一切変わらない
--     (対象2名へのUPDATEは別途、UUID確認後に個別実行する)。
-- ================================================================

ALTER TABLE public.brain_customers
  ADD COLUMN IF NOT EXISTS is_internal_user boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.brain_customers.is_internal_user IS
  'スタッフ本人の試用・検証購入等、実顧客ではない社内利用者フラグ。true時は通知/分析系の'
  '集計対象から除外する。自動判定キーが存在しないため手動で立てる運用'
  '(docs/NOTIFICATION_INTERNAL_USER_EXCLUSION.md・line_user_ids.is_staffと同じ方針)。';
