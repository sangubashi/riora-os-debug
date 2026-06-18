-- ================================================================
-- 多店舗展開準備: store_id 列の追加（データ構造のみ）
--
-- 目的:
--   将来の複数店舗展開に備え、主要テーブルに store_id を追加する。
--   今回は UI / RLS / 店舗切替機能の対応は行わず、データ構造のみ。
--
-- 対象テーブル:
--   customers, reservations, voice_notes, customer_notes,
--   customer_action_logs, profiles (スタッフ管理テーブル。
--   public.staff という名前のテーブルは存在しないため、
--   スタッフ管理を担う profiles を対象とする)
--
-- 方針:
--   1. stores テーブルを新設し、デフォルト店舗を1件登録
--   2. 各対象テーブルに store_id uuid 列を追加 (FK -> stores.id)
--   3. 既存レコードはデフォルト店舗へ backfill
--   4. NOT NULL + DEFAULT を設定し、store_id を指定しない
--      既存の INSERT もデフォルト店舗へ自動で紐付くようにする
--      （既存機能・CustomerBottomSheet / VoiceMemo / Timeline /
--        KPI / LINE への影響なし）
--   5. 対象6テーブルの既存 RLS ポリシーは変更しない。
--      将来 public.app_store_id() (20260612000005で定義済み) を使った
--      store_id ベースの RLS を追加できる構造としておく。
--
-- 冪等: 再実行可能
-- ================================================================

-- ----------------------------------------------------------------
-- 1. stores テーブル新設
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stores (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  is_default boolean     NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- デフォルト店舗（固定UUID。既存データの紐付け先）
INSERT INTO public.stores (id, name, is_default)
VALUES ('00000000-0000-0000-0000-000000000001', '本店', true)
ON CONFLICT (id) DO NOTHING;

-- 読み取りのみ許可。書き込みは管理者(service_role等)のみ
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stores_select_authenticated ON public.stores;
CREATE POLICY stores_select_authenticated ON public.stores
  FOR SELECT
  USING (auth.role() = 'authenticated');

GRANT SELECT ON public.stores TO authenticated;

-- ----------------------------------------------------------------
-- 2. 各テーブルへ store_id を追加・backfill・制約設定
-- ----------------------------------------------------------------
DO $$
DECLARE
  default_store_id uuid := '00000000-0000-0000-0000-000000000001';
  tbl       text;
  fkey_name text;
  idx_name  text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'customers',
    'reservations',
    'voice_notes',
    'customer_notes',
    'customer_action_logs',
    'profiles'
  ]
  LOOP
    fkey_name := tbl || '_store_id_fkey';
    idx_name  := 'idx_' || tbl || '_store_id';

    -- カラム追加（既存なら何もしない）
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS store_id uuid', tbl);

    -- 既存レコードをデフォルト店舗へ紐付け
    EXECUTE format('UPDATE public.%I SET store_id = %L WHERE store_id IS NULL', tbl, default_store_id);

    -- 以後の INSERT で store_id 未指定でもデフォルト店舗が入るようにする
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN store_id SET DEFAULT %L', tbl, default_store_id);

    -- NOT NULL 化
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN store_id SET NOT NULL', tbl);

    -- FK 制約（再実行時は既存なら追加しない）
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = fkey_name
        AND conrelid = format('public.%I', tbl)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (store_id) REFERENCES public.stores(id)',
        tbl, fkey_name
      );
    END IF;

    -- 検索・将来のRLS用インデックス
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (store_id)', idx_name, tbl);
  END LOOP;
END $$;

-- ================================================================
-- 将来のRLS拡張について（今回は未実施・参考メモ）
--
-- 各テーブルに store_id が追加されたことで、20260612000005で定義済みの
-- public.app_store_id() (current_setting('app.store_id', true)::uuid)
-- を利用し、将来的に以下のような店舗分離ポリシーを追加できる:
--
--   CREATE POLICY xxx_store_isolation ON public.customers
--     FOR ALL
--     USING (store_id = public.app_store_id())
--     WITH CHECK (store_id = public.app_store_id());
--
-- 現状はアプリ側で app.store_id を設定していないため、
-- 上記ポリシーを今追加すると全件0件になり既存機能が破壊される。
-- そのため今回は対象6テーブルの既存RLSポリシーには一切手を加えない。
-- ================================================================

-- 確認クエリ:
-- SELECT table_name, column_name, data_type, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND column_name = 'store_id'
-- ORDER BY table_name;
