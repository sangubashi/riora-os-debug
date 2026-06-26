-- ================================================================
-- 2026-06-19: CSV Import Phase1 — staff_name_aliases テーブル新設
--
-- 目的: SalonBoard CSV の担当者名（表記ゆれあり・テキスト）から
--       profiles.id（uuid）への解決を補助する別名マッピング表。
--
-- ⚠️ SUPERSEDED (2026-06-20): profiles前提の旧設計。brain_*方針確定により
-- 本ファイルは適用しないこと。代わりにbrain_staff.name_aliases(JSONB)を使う。
-- 正: docs/architecture/Riora_Management_Dashboard_Architecture_v2.1.md §5
--
-- 解決フロー（docs/CSV_IMPORT_PHASE1_DESIGN.md §1.4）:
--   ① profiles.staff_name / display_name と完全一致 → 解決
--   ② 不一致の場合、本テーブルの alias と一致 → 解決
--   ③ いずれも不一致 → 未解決（dry-runでインポート全体を中断）
--
-- 設計根拠: docs/CSV_IMPORT_PHASE1_DESIGN.md §1
-- 適用状態: 未適用（このファイルはレビュー用。承認後に別途適用する）
-- ================================================================

CREATE TABLE IF NOT EXISTS staff_name_aliases (
  alias       text        PRIMARY KEY,
  staff_id    uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_by  uuid        REFERENCES profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_name_aliases_staff_id
  ON staff_name_aliases (staff_id);

COMMENT ON TABLE staff_name_aliases IS
  'SalonBoard CSV取込における担当者名の表記ゆれ解決用マッピング表。aliasは normalizeStaffName() 適用後の正規化済み文字列を保存する。';

-- RLS方針（必須化）:
--   現状の取込処理はservice_role経由のみでこのテーブルにアクセスする
--   （service_roleはRLS/GRANTの両方をバイパスするため、以下の制限の
--   影響を受けない）。anon/authenticatedのいずれにもテーブル権限を
--   与えず、ownerのみアクセス可能なRLSポリシーを今のうちに定義して
--   おく。これにより、Phase2（CSV管理画面）でauthenticatedにGRANTを
--   追加する際は、このポリシーがそのまま機能し、スタッフ（owner以外の
--   authenticated）には常にゼロ件しか見えない状態を維持できる。
ALTER TABLE staff_name_aliases ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON staff_name_aliases FROM anon;
REVOKE ALL ON staff_name_aliases FROM authenticated;

CREATE POLICY "staff_name_aliases_owner_only" ON staff_name_aliases
  FOR ALL
  USING (is_owner())
  WITH CHECK (is_owner());
