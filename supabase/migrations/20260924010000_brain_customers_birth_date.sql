-- ================================================================
-- 顧客トップページ「生年月日・年齢」正確表示: brain_customers へのカラム追加
-- 設計根拠: 2026-09-24ユーザー承認(PII保護方針の例外化)
--
-- 背景: 従来、salonBoardParser.ts(isPiiColumn)は「生年月日」列名を含むCSV
-- カラムを自動的にPIIとしてスキップしており、docs/security/PII_POLICY_V1.md
-- の調査でも「生年月日・誕生日に対応する構造化カラムがシステム全体に
-- 存在しない」ことが既知のギャップとして記録されていた
-- (現場スタッフ運用上、正確な生年月日・年齢表示が必要という要望により、
-- 今回ユーザー承認のうえ本カラムを新設し、上記PII除外方針を
-- 生年月日に限り例外化する)。
--
-- 本カラムの追加のみでは既存の「売上明細CSV」取込パイプライン
-- (csvImportPipeline.ts)には生年月日に相当する列がそもそも存在しない
-- ため自動では入力されない。salonBoardParser.ts経由の取込
-- (SalonBoardImportEngine.ts)では本カラムへの取込配線を今回合わせて
-- 実装した。上記以外の経路(手動入力画面等)は今回のスコープ外。
--
-- 適用は別途明示的な承認があるまで行わない(本ファイルはレビュー用に
-- 作成のみ、brain_customer_facial_schemas/initial_questionnaireマイグレーション
-- と同じ運用)。
-- ================================================================

ALTER TABLE public.brain_customers
  ADD COLUMN IF NOT EXISTS birth_date date;

-- ================================================================
-- 適用後確認用SELECT(実行結果を目視確認してください)
-- ================================================================

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'brain_customers'
  AND column_name = 'birth_date';
