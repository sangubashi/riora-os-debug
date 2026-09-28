-- ================================================================
-- /karte「💆 今回の施術コース」機能: brain_visits へ1列追加
--
-- 設計根拠: 2026-09-28ユーザー承認。
-- 既存の brain_visits.options(Phase1-A、「🎯施術ポイント」7項目の固定チェックボックス、
-- スマホアプリ側 TreatmentRecordSection.tsx が使用)とは別のコース選択機能のため、
-- 同じ列を共用せず新規列を追加する(語彙・意味が異なる別データであり、共用すると
-- 両画面のPATCHが互いの選択内容を上書きしてしまうため)。machine_settings(Phase1-A、
-- 仕様未確定のため現在未使用)への転用も、列名の意味と実際の用途が乖離するため避けた。
--
-- 既存の options/products_used/machine_settings/treatment_memo・
-- menu_id/treatment_amount/retail_amount/staff_id/is_nomination 等には一切触れない。
-- ================================================================

ALTER TABLE public.brain_visits
  ADD COLUMN IF NOT EXISTS course_options jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.brain_visits.course_options IS
  '/karte「今回の施術コース」(2026-09-28)で選択したコース名の配列(固定14項目からの複数選択)。brain_visits.options(施術ポイント、別機能)とは独立。';
