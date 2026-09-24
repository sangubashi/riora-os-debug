-- ================================================================
-- SalonBoardテキスト取込項目の見直し: brain_customers への電話番号・性別カラム追加
-- 設計根拠: 2026-09-24ユーザー承認
--
-- 電話番号: 個人情報方針(docs/security/PII_POLICY_V1.md、「電話番号は保存しない」)の
-- 例外として、今回ユーザー承認のうえ現場運用上の必要性により保存を解禁する
-- (生年月日と同じ「個別フィールド単位での方針例外化」パターン)。SalonBoardの
-- 「電話番号1」欄のみを取り込む(電話番号2は対象外)。表示はPIN保護されたスタッフ
-- モード側に限定する(アプリ側の実装方針、DB側では制御しない)。
--
-- 性別: 機微情報ではあるが電話番号ほどの個人情報方針上の制約は無いため、通常の
-- 追加カラムとして新設する。カルテのトップページ(CustomerTopPage.tsx)に表示する。
--
-- 適用は別途明示的な承認があるまで行わない(本ファイルはレビュー用に作成のみ)。
-- ================================================================

ALTER TABLE public.brain_customers
  ADD COLUMN IF NOT EXISTS phone_number text,
  ADD COLUMN IF NOT EXISTS gender text;

-- ================================================================
-- 適用後確認用SELECT(実行結果を目視確認してください)
-- ================================================================

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'brain_customers'
  AND column_name IN ('phone_number', 'gender')
ORDER BY column_name;
