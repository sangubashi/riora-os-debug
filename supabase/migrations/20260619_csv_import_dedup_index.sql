-- ================================================================
-- 2026-06-19: CSV Import Phase1 — reservations 重複判定 UNIQUE INDEX
--
-- 目的: SalonBoard CSV取込の再実行時に同一来店が重複して
--       INSERTされることを防ぐ。
--
-- 重複判定キー: (customer_id, staff_id, 来店日[Asia/Tokyo基準])
--
-- ⚠️ SUPERSEDED (2026-06-20): customers/reservations前提の旧設計。
-- brain_*方針確定により本ファイルは適用しないこと。
-- 正: docs/architecture/CSVImportSecurityArchitecture.md
--
-- 設計根拠: docs/CSV_IMPORT_PHASE1_DESIGN.md §4
-- 前提: このファイルは 20260619_csv_import_reservations_source.sql の
--       後に適用すること（依存関係はないが、Phase1の適用順序として推奨）
-- 適用状態: 未適用（このファイルはレビュー用。承認後に別途適用する）
-- ================================================================

-- customer_id が NULL の既存予約（手動作成分等）は対象外とする部分インデックス。
-- scheduled_at は明示的に Asia/Tokyo に固定してから日付化する
-- （セッションの TimeZone GUC に依存させないため）。
CREATE UNIQUE INDEX IF NOT EXISTS uq_reservations_csv_dedup
  ON reservations (
    customer_id,
    staff_id,
    ((scheduled_at AT TIME ZONE 'Asia/Tokyo')::date)
  )
  WHERE customer_id IS NOT NULL;

-- 利用例（アプリケーション側のUPSERT文、参考。本ファイルでは実行しない）:
--
-- INSERT INTO reservations
--   (customer_id, staff_id, menu, price, scheduled_at, duration_minutes,
--    status, is_new_customer, notes, source)
-- VALUES
--   ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
-- ON CONFLICT (customer_id, staff_id, ((scheduled_at AT TIME ZONE 'Asia/Tokyo')::date))
-- DO UPDATE SET
--   menu   = EXCLUDED.menu,
--   price  = EXCLUDED.price,
--   notes  = EXCLUDED.notes,
--   source = EXCLUDED.source;
