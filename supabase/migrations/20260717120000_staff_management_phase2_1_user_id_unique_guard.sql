-- ================================================================
-- STAFF_MANAGEMENT_PHASE2_1_IMPLEMENT_1 (2026-07-17)
--
-- 目的: brain_staff.user_id への UNIQUE制約を、Phase1のマイグレーション
-- (20260716120000_staff_management_phase1.sql)が本番未適用のまま残っている
-- 状況(docs/STAFF_MANAGEMENT_PHASE2_1_AUDIT_1.md 1〜4章で読み取り専用確認済み)
-- を踏まえ、冪等な形で改めて用意する
-- (docs/STAFF_MANAGEMENT_PHASE2_1_AUDIT_1.md 5章の推奨形をそのまま採用)。
--
-- 注意: Phase1のマイグレーションファイル自体は変更しない(commit済みの不変の
-- 履歴として保持する)。本ファイルは「Phase1が未適用でも、Phase1適用後に
-- 重ねて適用されても、どちらのケースでも安全に効く(23505エラーにならない)」
-- ことを目的とした独立ファイルであり、Phase1のCOMMENT ON COLUMN文はここでは
-- 繰り返さない(Phase1適用時に既に付与される想定のため)。
--
-- 前提スキーマ(docs/STAFF_MANAGEMENT_PHASE2_DESIGN_2.md 1章・本番読み取り専用
-- クエリで再確認済み): brain_staff(id, store_id, name, style, is_active,
-- created_at, deleted_at, name_aliases, user_id)。
--
-- 既知の注意点(調査時に判明・実装時の混乱防止のため明記):
-- supabase/migrations/20260618_staff_roles_setup.sql は brain_staff を
-- auth_uid/profile_id/staff_name/role/anon_salt という全く異なる列構成で
-- CREATE TABLE IF NOT EXISTS しようとしているが、20260612000001_core_tables.sql
-- が先に本来のbrain_staff(name/style/user_id...)を作成済みのため IF NOT EXISTS
-- が効いて無視され、後続のINSERT(auth_uid列を参照)は実際には適用時に失敗する
-- はずである。本番の実スキーマ(STAFF_MANAGEMENT_PHASE2_1_AUDIT_1.mdで
-- 読み取り専用確認済み・4行とも id/name/user_id/is_active/deleted_at の形)は
-- 20260612000001_core_tables.sql + 未記録のuser_id列 の構成であり、
-- 20260618_staff_roles_setup.sqlのbrain_staff定義は本番に反映されていないと
-- 判断できる。本制約は「実際に本番で使われている方のbrain_staff」を対象とする。
--
-- 本番適用: このセッションでは行っていない(SQL実行禁止・本番データ更新禁止・
-- migration適用禁止の指示のため)。適用にはユーザー側での実行(supabase db push
-- 等)が別途必要。
-- ================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'brain_staff_user_id_unique'
  ) THEN

    ALTER TABLE public.brain_staff
    ADD CONSTRAINT brain_staff_user_id_unique
    UNIQUE (user_id);

  END IF;
END $$;
