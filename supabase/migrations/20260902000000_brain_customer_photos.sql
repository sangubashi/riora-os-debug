-- ================================================================
-- 写真カルテ機能: brain_customer_photos テーブル新設 (Phase1)
-- 設計根拠:
--   docs/PHOTO_KARTE_DB_DESIGN_1.md
--   docs/PHOTO_KARTE_API_DESIGN_1.md
--   docs/PHOTO_KARTE_MIGRATION_DESIGN_1.md
--
-- 方針(B案): authenticated への直接アクセスを一切許可せず、
--   書き込み(INSERT/UPDATE/DELETE)は service_role を使うサーバーAPI
--   (canAccessCustomer通過後)経由のみで行わせる。karte_imports の最終形
--   (20260808000000_karte_imports_service_role_only.sql)と同じ
--   「service_role限定ポリシーを明示的に作成する」方式をテンプレートとして採用し、
--   緩い状態(authenticatedへのGRANT/RLS許可)を一度も経由しない。
--
-- 【2026-09-02レビューで訂正】読み取り(SELECT)については「service_roleのみ」
--   ではない。riora_backup ロール(バックアップ専用、rolbypassrls=true)が
--   pg_default_acl(public スキーマ・postgres所有オブジェクト向け)により
--   本テーブルにも自動的にSELECT権限を持ち、かつRLSをバイパスするため、
--   実際にアクセス可能なロールは「service_role(読み書き) + riora_backup
--   (読み取りのみ、バックアップ用途、既存の brain_customers/brain_visits/
--   karte_imports/voice_notes 全てで同じ構成であることを実測確認済み)」の
--   2ロールとなる。authenticated/anon は引き続きいずれも不可
--   (pg_default_aclにriora_backup以外の自動付与は存在しないことを確認済み)。
--   PHOTO_KARTE_MIGRATION_DESIGN_1.md「riora_backupの権限について」節を参照。
--
-- 本ファイルはテーブル作成のみを対象とする。Storage bucket(customer-photos)の
-- 作成はSupabase Dashboard上の別手順とし、本migrationには含めない
-- (voice-notesと同じ運用、PHOTO_KARTE_DB_DESIGN_1.md 8-7節)。
--
-- 【2026-09-02レビューで訂正】新設テーブルであり、同名テーブルの非存在は
--   PHOTO_KARTE_MIGRATION_DESIGN_1.md 10節で確認済みのため、CREATE TABLE は
--   IF NOT EXISTS を使わず fail-fast させる(想定外の既存オブジェクトがあれば
--   migrationがエラーで停止し、異常に気付ける形にする)。CREATE INDEX / POLICY
--   は既存プロジェクト全体の慣行(karte_imports含む)に合わせ IF EXISTS/
--   IF NOT EXISTS を維持する(再作成コストが低く、対象範囲外と判断)。
--
-- 適用は別途明示的な承認があるまで行わない(本ファイルはレビュー用に作成のみ)。
-- ================================================================

-- ── 1. テーブル本体 ──────────────────────────────────────────────
-- カラム定義・PK・FK・CHECK・UNIQUE は PHOTO_KARTE_MIGRATION_DESIGN_1.md 1節・8節に対応
-- IF NOT EXISTS は使用しない(新設テーブルのためfail-fastを優先。上記コメント参照)
CREATE TABLE public.brain_customer_photos (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- store_id/customer_id/visit_id/created_by は個別FKのみで、
  -- 「customer_idとvisit_idが別顧客」等の複合的な整合性はDB制約では強制しない。
  -- 既存の brain_skin_records(customer_id・visit_idを両方持つ最も近い前例)も
  -- 同様に個別FKのみで複合FKを持たないことを確認済み(2026-09-02レビュー)。
  -- 整合性はAPI層(PHOTO_KARTE_API_DESIGN_1.md 2節手順7)で担保する。
  -- 詳細な判断根拠は PHOTO_KARTE_MIGRATION_DESIGN_1.md「store_id/customer_id/
  -- visit_id/created_byの整合性」節を参照。
  store_id       uuid        NOT NULL REFERENCES public.brain_stores(id)    ON DELETE CASCADE,
  customer_id    uuid        NOT NULL REFERENCES public.brain_customers(id) ON DELETE CASCADE,
  visit_id       uuid                 REFERENCES public.brain_visits(id)    ON DELETE SET NULL,
  body_part      text        NOT NULL,
  photo_type     text        NOT NULL DEFAULT 'progress'
                              CHECK (photo_type IN ('before', 'after', 'progress')),
  storage_path   text        NOT NULL,
  taken_at       timestamptz NOT NULL DEFAULT now(),
  -- created_by: auth.users.id(認証主体)ではなく brain_staff.id(Riora OS上の
  -- スタッフ主体)を参照する。API層は extractStaffFromRequest() が返す
  -- staffBrainId をここに格納する(authUserId は使わない)。
  -- PHOTO_KARTE_API_DESIGN_1.md 5-1節・PHOTO_KARTE_MIGRATION_DESIGN_1.md 7節。
  created_by     uuid                 REFERENCES public.brain_staff(id)     ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,

  -- 冪等性の最終防波堤。同一 storage_path の行は常に1件のみ許可する。
  -- clientRequestId起点の決定的パス生成と組み合わせ、DB制約レベルで
  -- 二重INSERTを排除する(PHOTO_KARTE_MIGRATION_DESIGN_1.md 8節)。
  CONSTRAINT ux_brain_customer_photos_storage_path UNIQUE (storage_path)
);

-- ── 2. インデックス ──────────────────────────────────────────────
-- 対応: PHOTO_KARTE_MIGRATION_DESIGN_1.md 3節(実際のAPIアクセスパターンに基づき
-- 3本のみ採用。store_id複合・created_by単体は過剰と判断し不採用)

-- 一覧取得のデフォルト並び順(customer_id + taken_at DESC)
CREATE INDEX IF NOT EXISTS idx_brain_customer_photos_customer_taken
  ON public.brain_customer_photos (customer_id, taken_at DESC)
  WHERE deleted_at IS NULL;

-- 経過比較(同一顧客・同一部位の絞り込み)
CREATE INDEX IF NOT EXISTS idx_brain_customer_photos_customer_bodypart
  ON public.brain_customer_photos (customer_id, body_part)
  WHERE deleted_at IS NULL;

-- Before/After比較(visit単位の取得)
CREATE INDEX IF NOT EXISTS idx_brain_customer_photos_visit
  ON public.brain_customer_photos (visit_id)
  WHERE deleted_at IS NULL;

-- ── 3. RLS ───────────────────────────────────────────────────────
-- 対応: PHOTO_KARTE_MIGRATION_DESIGN_1.md 5節
-- authenticated/anonを一切許可しない最終形を最初から採用する
-- (karte_importsのような「緩い状態→引き締め」の2段階を踏まない)。
-- 【2026-09-02レビューで訂正】ポリシー対象は service_role のみだが、
--   riora_backup は rolbypassrls=true のためRLS自体を評価されずSELECT可能
--   (上部の方針コメント参照)。これはRLSポリシーの不備ではなく、
--   バックアップ用ロールの仕様上当然の挙動であり是正対象ではない。
ALTER TABLE public.brain_customer_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bcp_select" ON public.brain_customer_photos;
CREATE POLICY "bcp_select" ON public.brain_customer_photos
  FOR SELECT TO service_role USING (true);

DROP POLICY IF EXISTS "bcp_insert" ON public.brain_customer_photos;
CREATE POLICY "bcp_insert" ON public.brain_customer_photos
  FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "bcp_update" ON public.brain_customer_photos;
CREATE POLICY "bcp_update" ON public.brain_customer_photos
  FOR UPDATE TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "bcp_delete" ON public.brain_customer_photos;
CREATE POLICY "bcp_delete" ON public.brain_customer_photos
  FOR DELETE TO service_role USING (true);

-- authenticated / anon 向けのポリシーは意図的に作成しない。
-- RLS有効化テーブルで対象ロールに合致するポリシーが無い場合、
-- そのロールからのアクセスは常に0件になる(default deny)。

-- ── 4. GRANT ─────────────────────────────────────────────────────
-- 対応: PHOTO_KARTE_MIGRATION_DESIGN_1.md 4節
-- service_role にのみ明示的にGRANTする(読み書き全権限)。authenticated には
-- 一切GRANTしない(pg_default_acl調査により、新規テーブルは何もしなければ
-- authenticated に自動で権限が付かないことを確認済みのため、REVOKE文自体が不要)。
-- riora_backup ロールへの明示的GRANT文は不要だが、pg_default_aclにより
-- SELECTのみ自動付与される点に注意(このGRANT文の対象外だが実際にはアクセス
-- 可能になる。上部の方針コメント・PHOTO_KARTE_MIGRATION_DESIGN_1.md参照)。
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.brain_customer_photos
  TO service_role;

-- ================================================================
-- 適用後確認用SELECT(実行結果を目視確認してください)
-- 既存migration(karte_import.sql / karte_imports_service_role_only.sql)の
-- 確認クエリと同じ形式に揃えている。
-- ================================================================

-- 5a. テーブルの列構成
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'brain_customer_photos'
ORDER BY ordinal_position;

-- 5b. 外部キー(store_id/customer_id/visit_id/created_byの参照先確認)
SELECT
  tc.table_name AS from_table,
  kcu.column_name AS from_column,
  ccu.table_name AS references_table,
  ccu.column_name AS references_column,
  rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
  ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
JOIN information_schema.referential_constraints rc
  ON tc.constraint_name = rc.constraint_name AND tc.table_schema = rc.constraint_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND tc.table_name = 'brain_customer_photos'
ORDER BY kcu.column_name;

-- 5c. UNIQUE制約(storage_path)の確認
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.brain_customer_photos'::regclass
  AND contype = 'u';

-- 5d. CHECK制約(photo_type)の確認
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.brain_customer_photos'::regclass
  AND contype = 'c';

-- 5e. インデックス一覧
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'brain_customer_photos'
ORDER BY indexname;

-- 5f. RLSポリシー: 全て roles = {service_role} になっていること
--     (authenticated/anonが一切含まれていないこと)を確認する。
--     ※ riora_backup はポリシー対象ではないが rolbypassrls=true のため
--       ここに現れなくてもSELECT可能な点に注意(5gと合わせて確認)。
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'brain_customer_photos'
ORDER BY policyname;

-- 5g. テーブルレベルGRANT: service_role にはSELECT/INSERT/UPDATE/DELETEが、
--     riora_backup にはSELECTのみが(pg_default_aclによる自動付与)現れることを
--     確認する。authenticated/anon には何も現れないことを確認する
--     (現れた場合は想定外・要調査)。
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'brain_customer_photos'
ORDER BY grantee, privilege_type;

-- 5h. RLSが有効なままであることの確認(念のため)
SELECT relrowsecurity, relforcerowsecurity
FROM pg_class
WHERE oid = 'public.brain_customer_photos'::regclass;
