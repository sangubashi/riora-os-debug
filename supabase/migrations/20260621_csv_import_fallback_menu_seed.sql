-- ================================================================
-- 2026-06-21: CSV Import Phase 3 — フォールバックメニュー seed
--
-- 背景: brain_visits.menu_id は NOT NULL の brain_menus FK だが、
-- 実際のSalonBoard売上明細CSVのメニュー名(例:「フェイシャルエステ 60分」)は
-- 既存seed(20260612000006)のメニュー名(「ヒト幹15000」等)と一致しない。
-- CSV取込側で名称突合に失敗した行を保存できるよう、各店舗に1件だけ
-- 「imported_other」ロールのフォールバックメニューを用意する
-- (SalonBoard_CSV_Import_Implementation_Architecture_v1.0.md §3
--  「メニュー/コース→menus突合(不一致は'imported_other')」に対応)。
--
-- 新規業務テーブルではなく既存brain_menusへのseed行追加のみ。
-- 冪等性: 既にrole='imported_other'の行を持つ店舗はスキップする。
--
-- 前提となるCHECK制約の拡張: brain_menus.roleは20260612000001_core_tables.sql
-- でCHECK (role IN ('entry','pore','sensitive','peeling','lifting'))済みのため、
-- 'imported_other'を許可するには制約自体を先に拡張する必要がある
-- (Postgresの無名CHECK制約は<table>_<column>_check命名規則のためその名前で
--  DROP→再ADDする。src/types/riora.types.tsのMenuRoleにも'imported_other'を
--  追記しDB CHECKとの一致を保つ)。
-- ================================================================

ALTER TABLE public.brain_menus
  DROP CONSTRAINT IF EXISTS brain_menus_role_check;

ALTER TABLE public.brain_menus
  ADD CONSTRAINT brain_menus_role_check
    CHECK (role IN ('entry', 'pore', 'sensitive', 'peeling', 'lifting', 'imported_other'));

INSERT INTO public.brain_menus (store_id, name, price, role)
SELECT s.id, 'CSV取込(メニュー名未マッチ)', 0, 'imported_other'
FROM public.brain_stores s
WHERE NOT EXISTS (
  SELECT 1 FROM public.brain_menus m
  WHERE m.store_id = s.id AND m.role = 'imported_other'
);

COMMENT ON COLUMN public.brain_menus.role IS
  'メニュー区分。通常は施術カテゴリ(entry/pore/sensitive/peeling/lifting等)。'
  '''imported_other''はCSV取込時にSalonBoardのメニュー名がbrain_menusと'
  '名称突合できなかった行の受け皿(CsvImportPipeline.resolveMenu参照)。';
