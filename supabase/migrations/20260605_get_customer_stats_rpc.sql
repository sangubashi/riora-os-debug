-- ================================================================
-- Riora OS: get_customer_stats RPC を migration 管理下へ移す
-- 実行: Supabase Dashboard > SQL Editor に貼り付けて Run
--
-- 返り値:
--   customer_id  UUID
--   visit_count  BIGINT  (reservations の件数)
--   total_sales  BIGINT  (customers.total_spent を採用)
--   last_visit   DATE    (reservations の最終 scheduled_at)
--
-- 設計:
--   reservations に price カラムがないため
--   来店回数・最終来店日は reservations から集計し
--   累計売上は customers.total_spent を使用する。
--
-- 冪等: CREATE OR REPLACE FUNCTION で安全
-- ================================================================

CREATE OR REPLACE FUNCTION public.get_customer_stats()
RETURNS TABLE (
  customer_id  UUID,
  visit_count  BIGINT,
  total_sales  BIGINT,
  last_visit   DATE
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    c.id                                      AS customer_id,
    COUNT(r.id)::BIGINT                       AS visit_count,
    COALESCE(c.total_spent, 0)::BIGINT        AS total_sales,
    MAX(r.scheduled_at::DATE)                 AS last_visit
  FROM
    public.customers c
  LEFT JOIN
    public.reservations r
      ON r.customer_id = c.id
      AND r.status IN ('completed', 'confirmed')
  GROUP BY
    c.id, c.total_spent;
$$;

-- 認証済みユーザーに実行権限を付与
GRANT EXECUTE ON FUNCTION public.get_customer_stats() TO authenticated;

COMMENT ON FUNCTION public.get_customer_stats IS
  'customers + reservations を JOIN して顧客ごとの来店回数・累計売上・最終来店日を返す。
   useCustomerStore.fetchCustomers() から呼び出される。';
