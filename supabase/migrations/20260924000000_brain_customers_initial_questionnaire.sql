-- ================================================================
-- 顧客トップページ「初回問診票」機能: brain_customers へのカラム追加
-- 設計根拠: 2026-09-24ユーザー承認(顧客トップページ新設)
--
-- 初回に紙で記入してもらった問診票をスキャンした画像1枚を、顧客ごとに
-- 1件だけ保持する(撮影のたびに追記するbrain_customer_photosとは異なり、
-- 常に最新の1枚で上書きする運用)。既存のphoto_type CHECK制約
-- ('before'/'after'/'progress')・ghostSelection.ts/comparisonSelection.tsの
-- ゴースト・比較ロジックには一切影響しない、独立した保存先として新設する。
--
-- 実ファイルはbrain_customer_photosと同じStorage bucket(customer-photos)の
-- 'initial-questionnaires/{customerId}/...' プレフィックス配下に保存し、
-- このカラムにはそのStorage上のパスのみを保持する(署名URLは都度API側で発行)。
--
-- 適用は別途明示的な承認があるまで行わない(本ファイルはレビュー用に作成のみ、
-- brain_customer_facial_schemasマイグレーションと同じ運用)。
-- ================================================================

ALTER TABLE public.brain_customers
  ADD COLUMN IF NOT EXISTS initial_questionnaire_photo_path text,
  ADD COLUMN IF NOT EXISTS initial_questionnaire_uploaded_at timestamptz;

-- ================================================================
-- 適用後確認用SELECT(実行結果を目視確認してください)
-- ================================================================

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'brain_customers'
  AND column_name IN ('initial_questionnaire_photo_path', 'initial_questionnaire_uploaded_at')
ORDER BY column_name;
