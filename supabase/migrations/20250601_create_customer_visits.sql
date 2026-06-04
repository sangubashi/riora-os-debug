-- ============================================================
-- migration: create customer_visits table
-- 目的: 来店履歴を customers / customer_action_logs から分離
-- ============================================================

-- 1. customer_visits テーブル作成
CREATE TABLE IF NOT EXISTS public.customer_visits (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     uuid        NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  visit_date      date        NOT NULL,
  treatment       text        NOT NULL DEFAULT '',
  sales           integer     NOT NULL DEFAULT 0,
  retail_sales    integer     NOT NULL DEFAULT 0,
  staff_name      text        NOT NULL DEFAULT '',
  has_next_rebook boolean     NOT NULL DEFAULT false,
  is_designated   boolean     NOT NULL DEFAULT false,
  source          text        NOT NULL DEFAULT 'manual'
                  CHECK (source IN ('salonboard_csv', 'manual', 'square')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- 2. インデックス
CREATE INDEX IF NOT EXISTS idx_customer_visits_customer_id
  ON public.customer_visits (customer_id);

CREATE INDEX IF NOT EXISTS idx_customer_visits_visit_date
  ON public.customer_visits (visit_date DESC);

CREATE INDEX IF NOT EXISTS idx_customer_visits_customer_date
  ON public.customer_visits (customer_id, visit_date DESC);

-- 3. 重複防止: 同顧客 × 同日 × 同source は1件のみ
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_visits_unique
  ON public.customer_visits (customer_id, visit_date, source);

-- 4. RLS 設定
ALTER TABLE public.customer_visits ENABLE ROW LEVEL SECURITY;

-- authenticated ユーザーは全件 SELECT 可能
CREATE POLICY "authenticated_select" ON public.customer_visits
  FOR SELECT TO authenticated USING (true);

-- authenticated ユーザーは INSERT 可能
CREATE POLICY "authenticated_insert" ON public.customer_visits
  FOR INSERT TO authenticated WITH CHECK (true);

-- authenticated ユーザーは UPDATE 可能
CREATE POLICY "authenticated_update" ON public.customer_visits
  FOR UPDATE TO authenticated USING (true);

-- 5. customers テーブルに customer_hash_id カラムを追加（なければ）
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS customer_hash_id text UNIQUE;

-- 6. コメント
COMMENT ON TABLE public.customer_visits IS
  '来店履歴テーブル。SalonBoard CSV取込・手動入力・Square連携の来店を記録する。';
COMMENT ON COLUMN public.customer_visits.source IS
  'データソース: salonboard_csv / manual / square';
COMMENT ON COLUMN public.customer_visits.has_next_rebook IS
  'その来店時に次回予約を取ったか';
COMMENT ON COLUMN public.customer_visits.is_designated IS
  '指名来店か';
