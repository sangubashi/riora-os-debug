-- ================================================================
-- 2026-06-19: CSV Import Phase1 — import_logs テーブル新設
--
-- 目的: SalonBoard CSV取込の実行履歴・結果を記録し、
--       再実行時の冪等性確認・障害検知の手がかりにする。
--
-- 設計根拠: docs/CSV_IMPORT_PHASE1_DESIGN.md §3
-- 適用状態: 未適用
-- ⚠️ SUPERSEDED (2026-06-20): brain_*方針確定により本ファイルは適用しない。
-- 代わりにbrain_ops_logs(brain_接頭辞・汎用)を新設する。
-- 正: docs/architecture/CSVImportSecurityArchitecture.md
-- ================================================================

CREATE TABLE IF NOT EXISTS import_logs (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source                text        NOT NULL,
  file_name             text,
  total_rows            integer     NOT NULL,
  inserted_customers    integer     NOT NULL DEFAULT 0,
  updated_customers     integer     NOT NULL DEFAULT 0,
  inserted_reservations integer     NOT NULL DEFAULT 0,
  updated_reservations  integer     NOT NULL DEFAULT 0,
  skipped_rows          integer     NOT NULL DEFAULT 0,
  unresolved_staff_names text[],
  imported_by           uuid        REFERENCES profiles(id),
  started_at            timestamptz NOT NULL DEFAULT now(),
  finished_at           timestamptz,
  status                text        NOT NULL DEFAULT 'running'
                          CHECK (status IN ('running', 'completed', 'failed', 'aborted_unresolved_staff')),
  error_message         text
);

CREATE INDEX IF NOT EXISTS idx_import_logs_source_started_at
  ON import_logs (source, started_at DESC);

COMMENT ON TABLE import_logs IS
  'CSV取込（SalonBoard等）の実行履歴。Pass A(顧客)/Pass B(予約)それぞれの件数とdry-run中断時の未解決スタッフ名一覧を記録する。';

-- RLS方針（必須化）:
--   取込処理（service_role経由、RLS/GRANTをバイパスする）からの
--   書き込みのみを想定。anon/authenticatedのいずれにもテーブル権限を
--   与えず、ownerのみアクセス可能なRLSポリシーを定義する。Phase2
--   （CSV管理画面）でownerが取込履歴を閲覧する際は、authenticatedに
--   GRANTを追加するだけでこのポリシーがそのまま機能する。
ALTER TABLE import_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON import_logs FROM anon;
REVOKE ALL ON import_logs FROM authenticated;

CREATE POLICY "import_logs_owner_only" ON import_logs
  FOR ALL
  USING (is_owner())
  WITH CHECK (is_owner());
