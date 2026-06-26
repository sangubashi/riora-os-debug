-- ================================================================
-- 2026-06-19: CSV Import Phase1 — reservations.source 追加
--
-- 目的: SalonBoard CSV取込で作成された予約データを、手動作成分と
--       区別できるようにする。
--
-- 設計根拠: docs/CSV_IMPORT_PHASE1_DESIGN.md §2
-- 適用状態: 未適用
-- ⚠️ SUPERSEDED (2026-06-20): brain_*方針確定により本ファイルは適用しない。
-- reservationsへのALTERではなくbrain_visits側で再設計する。
-- 正: docs/architecture/CSVImportSecurityArchitecture.md
-- ================================================================

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS source text;

COMMENT ON COLUMN reservations.source IS
  '予約データの取込元。CSV取込の場合は salonboard_import を設定。手動作成は NULL のまま運用。';

-- NOT NULL制約・CHECK制約は付けない。
-- 理由: 既存の手動作成分は source が NULL のままであり、
--       将来他の取込元（他社POS連携等）が増える可能性があるため、
--       許可値リストを今の時点で固定しない。
