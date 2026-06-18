-- ================================================================
-- 2026-06-18: スタッフロール設定 + brain_staff 紐付け
--
-- 1. profiles: 久保田(owner)/鈴木/亀山/外舘 を設定
-- 2. brain_staff: auth.users ↔ profiles ↔ brain_staff の紐付け
-- 3. is_owner() / is_staff() ヘルパー関数を整備
-- 4. customers / reservations RLS を role ベースに更新
-- ================================================================

-- ----------------------------------------------------------------
-- 1. profiles UPSERT（4名分）
-- ----------------------------------------------------------------

INSERT INTO public.profiles (id, role, staff_name, display_name)
VALUES
  ('38de1631-72d5-4891-a2af-5e2830f0326f', 'owner', '久保田', '久保田 オーナー'),
  ('ae68433d-69ce-4dc3-a38e-cc2501895fee', 'staff', '鈴木',   '鈴木'),
  ('0688b0ec-668c-4c5d-a30e-a6e817f6d399', 'staff', '亀山',   '亀山'),
  ('978ba4be-7b83-48ff-8914-d12ad6e82754', 'staff', '外舘',   '外舘')
ON CONFLICT (id) DO UPDATE
  SET role         = EXCLUDED.role,
      staff_name   = EXCLUDED.staff_name,
      display_name = EXCLUDED.display_name;

-- ----------------------------------------------------------------
-- 2. brain_staff テーブル (auth.users ↔ profiles の橋渡し)
--    service_role 専用（RLSで authenticated はブロック）
--    brain_events の staff_anon_id 生成元として利用
-- ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.brain_staff (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_uid      uuid        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  profile_id    uuid        NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  store_id      uuid        REFERENCES public.stores(id) ON DELETE SET NULL,
  staff_name    text        NOT NULL,
  role          text        NOT NULL CHECK (role IN ('owner','staff','admin')),
  anon_salt     text        NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brain_staff_auth_uid  ON public.brain_staff (auth_uid);
CREATE INDEX IF NOT EXISTS idx_brain_staff_store_id  ON public.brain_staff (store_id);

ALTER TABLE public.brain_staff ENABLE ROW LEVEL SECURITY;

-- service_role のみアクセス可（Edge Function / ETL 用）
DROP POLICY IF EXISTS brain_staff_svc_only ON public.brain_staff;
CREATE POLICY brain_staff_svc_only ON public.brain_staff
  USING (false);  -- authenticated からは全件ブロック / service_role は RLS バイパス

GRANT SELECT, INSERT, UPDATE ON public.brain_staff TO service_role;

-- brain_staff に4名を登録（stores が存在しない場合は store_id=NULL）
INSERT INTO public.brain_staff (auth_uid, profile_id, store_id, staff_name, role)
SELECT
  p.id                                     AS auth_uid,
  p.id                                     AS profile_id,
  (SELECT id FROM public.stores WHERE is_default = true LIMIT 1) AS store_id,
  p.staff_name,
  p.role
FROM public.profiles p
WHERE p.id IN (
  '38de1631-72d5-4891-a2af-5e2830f0326f',
  'ae68433d-69ce-4dc3-a38e-cc2501895fee',
  '0688b0ec-668c-4c5d-a30e-a6e817f6d399',
  '978ba4be-7b83-48ff-8914-d12ad6e82754'
)
ON CONFLICT (auth_uid) DO UPDATE
  SET staff_name = EXCLUDED.staff_name,
      role       = EXCLUDED.role,
      updated_at = now();

-- ----------------------------------------------------------------
-- 3. RLS ヘルパー関数（JWT app_metadata 優先 → profiles フォールバック）
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'owner'
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'owner'
    )
$$;

CREATE OR REPLACE FUNCTION public.is_staff_or_owner()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT
    (auth.jwt() -> 'app_metadata' ->> 'role') IN ('owner','staff')
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('owner','staff')
    )
$$;

-- ----------------------------------------------------------------
-- 4. customers RLS: owner=全件, staff=担当のみ
-- ----------------------------------------------------------------

DROP POLICY IF EXISTS "customers_select" ON public.customers;
CREATE POLICY "customers_select" ON public.customers
  FOR SELECT TO authenticated
  USING (
    public.is_owner()
    OR assigned_staff_id = auth.uid()
  );

DROP POLICY IF EXISTS "customers_insert" ON public.customers;
CREATE POLICY "customers_insert" ON public.customers
  FOR INSERT TO authenticated
  WITH CHECK (public.is_staff_or_owner());

DROP POLICY IF EXISTS "customers_update" ON public.customers;
CREATE POLICY "customers_update" ON public.customers
  FOR UPDATE TO authenticated
  USING (public.is_owner() OR assigned_staff_id = auth.uid());

-- ----------------------------------------------------------------
-- 5. reservations RLS: owner=全件, staff=自分のみ
-- ----------------------------------------------------------------

DROP POLICY IF EXISTS "reservations_select" ON public.reservations;
CREATE POLICY "reservations_select" ON public.reservations
  FOR SELECT TO authenticated
  USING (
    public.is_owner()
    OR staff_id = auth.uid()
  );

-- ----------------------------------------------------------------
-- 6. get_customer_stats RPC: owner=全件, staff=担当顧客のみ
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_customer_stats()
RETURNS TABLE(
  customer_id  uuid,
  visit_count  bigint,
  total_sales  bigint,
  last_visit   date
)
LANGUAGE sql SECURITY INVOKER STABLE AS $$
  SELECT
    r.customer_id,
    COUNT(*)::bigint          AS visit_count,
    SUM(r.price)::bigint      AS total_sales,
    MAX(r.scheduled_at::date) AS last_visit
  FROM public.reservations r
  WHERE
    public.is_owner()
    OR r.staff_id = auth.uid()
  GROUP BY r.customer_id
$$;

GRANT EXECUTE ON FUNCTION public.get_customer_stats() TO authenticated;

-- ----------------------------------------------------------------
-- 7. スタッフ別月次売上 RPC（新規）
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_my_monthly_sales(
  target_month date DEFAULT date_trunc('month', now())::date
)
RETURNS TABLE(
  staff_id          uuid,
  month             date,
  total_sales       bigint,
  reservation_count bigint
)
LANGUAGE sql SECURITY INVOKER STABLE AS $$
  SELECT
    r.staff_id,
    date_trunc('month', r.scheduled_at)::date AS month,
    SUM(r.price)::bigint                       AS total_sales,
    COUNT(*)::bigint                           AS reservation_count
  FROM public.reservations r
  WHERE
    date_trunc('month', r.scheduled_at)::date = target_month
    AND (
      public.is_owner()
      OR r.staff_id = auth.uid()
    )
  GROUP BY r.staff_id, date_trunc('month', r.scheduled_at)
$$;

GRANT EXECUTE ON FUNCTION public.get_my_monthly_sales(date) TO authenticated;
