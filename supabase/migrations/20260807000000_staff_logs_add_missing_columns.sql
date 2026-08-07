-- ================================================================
-- staff_logs: CustomerBottomSheet.tsx の saveLog() が書き込む列を追加
--
-- 背景: docs/STAFF_LOGS_SCHEMA_MISMATCH_DESIGN.md
-- CustomerBottomSheet.tsx の saveLog() は ai_adopted/next_reserved/option_sold/
-- retail_sold/churn_followed/service_completed の6列へINSERTしているが、
-- 本番の staff_logs にはこれらの列が存在せず保存が失敗していた
-- (実地再現で PGRST204 "Could not find the 'ai_adopted' column ... in the
-- schema cache" を実測確認済み)。
--
-- supabase/migrations/create_staff_logs.sql (DROP TABLE ... CASCADE による
-- 再作成) は既存データ損失・RLS再作成のリスクがあるため不採用。
-- 既存列(log_text/services_done/next_visit_recommended_at)・既存データ・
-- 既存RLSポリシーを一切変更せず、不足列だけを追加する(案A)。
-- ================================================================

ALTER TABLE public.staff_logs
  ADD COLUMN IF NOT EXISTS ai_adopted        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS next_reserved     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS option_sold       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retail_sold       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS churn_followed    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS service_completed boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.staff_logs.ai_adopted IS
  'CustomerBottomSheet.tsx saveLog()の「AI提案を活用した」自己申告チェック。docs/STAFF_LOGS_SCHEMA_MISMATCH_DESIGN.md 案A。';
COMMENT ON COLUMN public.staff_logs.next_reserved IS
  'saveLog()の「次回予約が取れた」自己申告チェック。';
COMMENT ON COLUMN public.staff_logs.option_sold IS
  'saveLog()の「オプションを提案した」自己申告チェック。';
COMMENT ON COLUMN public.staff_logs.retail_sold IS
  'saveLog()の「物販が売れた」自己申告チェック。';
COMMENT ON COLUMN public.staff_logs.churn_followed IS
  'saveLog()の「離脱フォローをした」自己申告チェック。';
COMMENT ON COLUMN public.staff_logs.service_completed IS
  'saveLog()が接客ログ保存時に常にtrueで送る完了フラグ。';
