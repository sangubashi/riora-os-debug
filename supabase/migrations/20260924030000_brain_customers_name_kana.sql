-- ================================================================
-- SalonBoardテキスト貼り付け取込機能: brain_customers へのフリガナ列追加
-- 設計根拠: 2026-09-24ユーザー承認(顧客トップページでのフリガナ表示)
--
-- SalonBoard「お客様情報詳細」の「氏名 (カナ)」欄を取り込んで保持する。
-- brain_customers.name(漢字)は既存のまま上書きしない方針を維持し、
-- カナは別カラム(name_kana)として追加する。
--
-- 適用は別途明示的な承認があるまで行わない(本ファイルはレビュー用に作成のみ、
-- 既存のbirth_date等のマイグレーションと同じ運用)。
-- ================================================================

ALTER TABLE public.brain_customers
  ADD COLUMN IF NOT EXISTS name_kana text;

-- ================================================================
-- 適用後確認用SELECT(実行結果を目視確認してください)
-- ================================================================

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'brain_customers'
  AND column_name = 'name_kana';
