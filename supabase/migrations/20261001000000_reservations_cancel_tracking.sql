-- ============================================================
-- reservations: 当日キャンセル機能(/karte)のキャンセル状態追跡カラム
-- ============================================================
-- 目的:
--   ・cancelled_at : キャンセル操作を行った日時(NULL=キャンセルされていない、または
--                    日時が記録されていない過去のcancelledデータ)
--   ・cancel_source: キャンセルの出どころ。
--                      'manual'         = カルテアプリ(/karte)で手動キャンセルした予約
--                      'salonboard_csv' = サロンボードCSV取込でcancelledになった予約
--                    NULL = 未設定(既存データ全件・キャンセルされていない予約)
--
-- 方針:
--   ・既存のstatus(confirmed/in_progress/completed/cancelled)はそのまま利用する。
--   ・予約データは削除しない(キャンセルはstatusの更新のみ・取消で元に戻せる)。
--   ・既存のcancelledデータ(78件)は推測で分類しない(両カラムともNULLのまま)。
--   ・手動キャンセル(cancel_source='manual')はCSV再取込で上書きしない
--     (reservationImportPipeline.ts側で保護)。
--
-- 安全性: NULL許容カラムの追加のみ(既存行・既存クエリに影響なし)。
-- ============================================================

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS cancelled_at  timestamptz NULL,
  ADD COLUMN IF NOT EXISTS cancel_source text        NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reservations_cancel_source_check'
      AND conrelid = 'public.reservations'::regclass
  ) THEN
    ALTER TABLE public.reservations
      ADD CONSTRAINT reservations_cancel_source_check
      CHECK (cancel_source IS NULL OR cancel_source IN ('manual', 'salonboard_csv'));
  END IF;
END $$;

COMMENT ON COLUMN public.reservations.cancelled_at IS
  'キャンセル操作の日時。/karteの手動キャンセル時にセット、取消でNULLへ戻す。既存データはNULL。';
COMMENT ON COLUMN public.reservations.cancel_source IS
  'manual=カルテアプリで手動キャンセル / salonboard_csv=CSV取込でcancelled。既存データはNULL(推測分類しない)。';
