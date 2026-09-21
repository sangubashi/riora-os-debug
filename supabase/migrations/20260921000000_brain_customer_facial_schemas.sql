-- ================================================================
-- 顔シェーマ機能: brain_customer_facial_schemas テーブル新設 (Phase 1)
-- 設計根拠: 実装計画(2026-09-21、顔シェーマ機能READ ONLY設計・Phase 0)
--
-- 方針: brain_customer_photos(20260902000000_brain_customer_photos.sql)の
--   「service_role限定ポリシーを明示的に作成する」方式(B案)をそのまま踏襲する。
--   authenticated/anonへの直接アクセスは一切許可せず、書き込み(INSERT/UPDATE/
--   DELETE)は service_role を使うサーバーAPI(canAccessCustomer通過後)経由の
--   みで行わせる。riora_backupロール(rolbypassrls=true)がpg_default_aclにより
--   自動的にSELECT可能になる点もbrain_customer_photosと同じ(是正対象ではない)。
--
-- brain_customer_photosとの意図的な差分: 写真は撮影のたびに新規INSERTする
--   (常に追記型)のに対し、顔シェーマは「同じ来店・同じ日の記録を保存後も
--   描き直し続ける」性質があるため、customer_id×来店機会(visit_idまたは
--   撮影日)につき1行をUPSERTする設計にする。この「撮影機会(occasion)」の
--   考え方自体はsrc/lib/photos/comparisonSelection.tsのoccasionKey()と
--   完全に同じもの(visit_idがあれば`visit:${id}`、無ければ撮影日
--   `date:${YYYY-MM-DD}`)を踏襲し、visit_id/schema_dateの2カラムで表現する。
--   これにより、iPad撮影時点でbrain_visitsが未作成(施術後にCSV取込または
--   接客ログ保存で初めて作られる)という写真機能と同じ制約下でも、1機会=1行を
--   一意制約で保証できる。
--
-- 新設テーブルであり同名テーブルの非存在は確認済みのため、CREATE TABLE は
-- IF NOT EXISTS を使わず fail-fast させる(brain_customer_photosと同じ方針)。
-- CREATE INDEX / POLICY は既存プロジェクト全体の慣行に合わせ IF EXISTS/
-- IF NOT EXISTS を維持する。
--
-- 適用は別途明示的な承認があるまで行わない(本ファイルはレビュー用に作成のみ)。
-- ================================================================

-- ── 1. テーブル本体 ──────────────────────────────────────────────
-- store_id/customer_id/visit_id/created_by/updated_by は個別FKのみで、
-- 複合的な整合性(customer_idとvisit_idが別顧客等)はDB制約では強制しない。
-- brain_customer_photosと同じ判断(整合性はAPI層で担保する)。
CREATE TABLE public.brain_customer_facial_schemas (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      uuid        NOT NULL REFERENCES public.brain_stores(id)    ON DELETE CASCADE,
  customer_id   uuid        NOT NULL REFERENCES public.brain_customers(id) ON DELETE CASCADE,
  visit_id      uuid                 REFERENCES public.brain_visits(id)    ON DELETE SET NULL,
  -- 「撮影機会」キー(JST)。visit_idの有無に関わらず常に設定する
  -- (comparisonSelection.tsのoccasionKey()と同じ考え方をカラムとして表現)。
  schema_date   date        NOT NULL,
  -- 将来的に正面以外のテンプレート(左右斜め・額等)を追加する余地を残すための
  -- 拡張カラム。現時点では'face_front'固定(仕様上は正面のみ対応)。
  template_key  text        NOT NULL DEFAULT 'face_front',
  -- ストローク座標データ(画像化しない)。テンプレート画像に対する正規化座標
  -- (0〜1)で保持する。versionフィールドで将来の形式変更に備える。
  -- 色・線種はここに焼き込まず、アプリ側(facialSchemaCategories.ts)で
  -- categoryから都度解決する(bodyPartLabel()と同じ「表示は都度解決」方針)。
  strokes_data  jsonb       NOT NULL DEFAULT '{"version": 1, "strokes": []}'::jsonb,
  -- created_by/updated_by: auth.users.id ではなく brain_staff.id を参照する
  -- (brain_customer_photos.created_byと同じ方針。API層はextractStaffFromRequest()
  -- が返すstaffBrainId、または店舗共通ログイン時はresolveStaffIdOverride()の
  -- 結果をここに格納する)。
  created_by    uuid                 REFERENCES public.brain_staff(id)     ON DELETE SET NULL,
  updated_by    uuid                 REFERENCES public.brain_staff(id)     ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

-- ── 2. ユニーク制約(1撮影機会につき1行) ──────────────────────────
-- visit_idが確定している機会: 同一顧客・同一visitにつき1行のみ。
CREATE UNIQUE INDEX IF NOT EXISTS ux_facial_schemas_customer_visit
  ON public.brain_customer_facial_schemas (customer_id, visit_id)
  WHERE visit_id IS NOT NULL AND deleted_at IS NULL;

-- visit_id未確定(iPad撮影時点でbrain_visits未作成)の機会: 同一顧客・同一
-- 撮影日につき1行のみ。写真機能のoccasionKey()の日付キーと同じ粒度。
CREATE UNIQUE INDEX IF NOT EXISTS ux_facial_schemas_customer_date
  ON public.brain_customer_facial_schemas (customer_id, schema_date)
  WHERE visit_id IS NULL AND deleted_at IS NULL;

-- ── 3. インデックス ──────────────────────────────────────────────
-- 履歴一覧・前回比較の取得(customer_id + schema_date DESC)
CREATE INDEX IF NOT EXISTS idx_facial_schemas_customer_date
  ON public.brain_customer_facial_schemas (customer_id, schema_date DESC)
  WHERE deleted_at IS NULL;

-- 来店記録からの逆引き(接客ログ保存時の事後紐付け処理等)
CREATE INDEX IF NOT EXISTS idx_facial_schemas_visit
  ON public.brain_customer_facial_schemas (visit_id)
  WHERE deleted_at IS NULL;

-- ── 4. RLS ───────────────────────────────────────────────────────
-- brain_customer_photosと同じ「service_role限定」方式。authenticated/anonを
-- 一切許可しない最終形を最初から採用する(緩い状態を経由しない)。
ALTER TABLE public.brain_customer_facial_schemas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bcfs_select" ON public.brain_customer_facial_schemas;
CREATE POLICY "bcfs_select" ON public.brain_customer_facial_schemas
  FOR SELECT TO service_role USING (true);

DROP POLICY IF EXISTS "bcfs_insert" ON public.brain_customer_facial_schemas;
CREATE POLICY "bcfs_insert" ON public.brain_customer_facial_schemas
  FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "bcfs_update" ON public.brain_customer_facial_schemas;
CREATE POLICY "bcfs_update" ON public.brain_customer_facial_schemas
  FOR UPDATE TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "bcfs_delete" ON public.brain_customer_facial_schemas;
CREATE POLICY "bcfs_delete" ON public.brain_customer_facial_schemas
  FOR DELETE TO service_role USING (true);

-- authenticated / anon 向けのポリシーは意図的に作成しない(default deny)。

-- ── 5. GRANT ─────────────────────────────────────────────────────
-- service_role にのみ明示的にGRANTする(読み書き全権限)。authenticated には
-- 一切GRANTしない(brain_customer_photosと同じくpg_default_aclにより新規
-- テーブルは何もしなければauthenticatedに自動で権限が付かないことを確認済み)。
-- riora_backupロールへの明示的GRANT文は不要だが、pg_default_aclにより
-- SELECTのみ自動付与される点に注意(brain_customer_photosと同じ挙動)。
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.brain_customer_facial_schemas
  TO service_role;

-- ================================================================
-- 適用後確認用SELECT(実行結果を目視確認してください)
-- brain_customer_photosの確認クエリと同じ形式に揃えている。
-- ================================================================

-- 6a. テーブルの列構成
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'brain_customer_facial_schemas'
ORDER BY ordinal_position;

-- 6b. 外部キー(store_id/customer_id/visit_id/created_by/updated_byの参照先確認)
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
  AND tc.table_name = 'brain_customer_facial_schemas'
ORDER BY kcu.column_name;

-- 6c. ユニークインデックス(occasion単位の一意性)の確認
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'brain_customer_facial_schemas'
  AND indexname LIKE 'ux_%'
ORDER BY indexname;

-- 6d. インデックス一覧(全体)
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'brain_customer_facial_schemas'
ORDER BY indexname;

-- 6e. RLSポリシー: 全て roles = {service_role} になっていること
--     (authenticated/anonが一切含まれていないこと)を確認する。
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'brain_customer_facial_schemas'
ORDER BY policyname;

-- 6f. テーブルレベルGRANT: service_role にはSELECT/INSERT/UPDATE/DELETEが、
--     riora_backup にはSELECTのみが(pg_default_aclによる自動付与)現れることを
--     確認する。authenticated/anon には何も現れないことを確認する
--     (現れた場合は想定外・要調査)。
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'brain_customer_facial_schemas'
ORDER BY grantee, privilege_type;

-- 6g. RLSが有効なままであることの確認(念のため)
SELECT relrowsecurity, relforcerowsecurity
FROM pg_class
WHERE oid = 'public.brain_customer_facial_schemas'::regclass;
