-- ================================================================
-- /karte「今回の施術」オプション枠: brain_visits へ1列追加
--
-- 設計根拠: 2026-09-28ユーザー承認。「今回の施術」を「メインコース」(既存の
-- course_options、固定14項目)と「オプション」(本対応の固定26項目・4カテゴリ)に
-- 構造化し、それぞれ独立して選択・保存できるようにする。
--
-- 既存の course_options(メインコース)・options(施術ポイント、スマホアプリ側
-- TreatmentRecordSection.tsxが使用)・products_used/machine_settings/treatment_memoには
-- 一切触れない。
-- ================================================================

ALTER TABLE public.brain_visits
  ADD COLUMN IF NOT EXISTS option_items jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.brain_visits.option_items IS
  '/karte「今回の施術」オプション枠(2026-09-28)で選択したオプション名の配列(固定26項目・4カテゴリからの複数選択)。course_options(メインコース)・options(施術ポイント、スマホアプリ側)とは独立して保存・取得される。';
