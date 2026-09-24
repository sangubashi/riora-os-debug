-- ================================================================
-- SalonBoardテキスト貼り付け取込機能: brain_customers へのカラム追加
-- 設計根拠: 2026-09-24ユーザー承認(顧客トップページからの既存顧客情報補完)
--
-- 「初回来店日」(first_visit_date)・「来店きっかけ」(acquisition_channel)は
-- 既存カラムをそのまま利用する(重複追加しない)。本マイグレーションで新設するのは
-- 既存カラムが無い2項目のみ:
--   - salonboard_visit_count: SalonBoard「来店回数」欄の数値(実測来店記録の集計値
--     (brain_visits由来)とは別物であることを明示するため、あえて汎用の"visit_count"
--     ではなくSalonBoard由来であることが分かる名前にする)。
--   - postcard_consent: 「はがき送付許諾」欄の値をそのまま文字列で保持する
--     (「送付NG」「送付OK」等、選択肢を厳密に列挙せず原文を保持する方針)。
--
-- 電話番号は個人情報方針により解析するが保存しない(このマイグレーションでは
-- 電話番号用のカラムを一切追加しない)。
--
-- 適用は別途明示的な承認があるまで行わない(本ファイルはレビュー用に作成のみ、
-- 既存のbirth_date/initial_questionnaireマイグレーションと同じ運用)。
-- ================================================================

ALTER TABLE public.brain_customers
  ADD COLUMN IF NOT EXISTS salonboard_visit_count integer,
  ADD COLUMN IF NOT EXISTS postcard_consent text;

-- ================================================================
-- 適用後確認用SELECT(実行結果を目視確認してください)
-- ================================================================

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'brain_customers'
  AND column_name IN ('salonboard_visit_count', 'postcard_consent')
ORDER BY column_name;
