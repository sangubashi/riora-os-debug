-- ================================================================
-- visit_count_at の一括修復(来店日昇順に振り直し)。冪等・何度実行しても同じ結果。
-- 前提: migration 20261002100000_visit_count_at_by_date_order.sql が適用済みであること。
-- 2026-10-02 本番(ohszxgajckzphhfhdrsv)で実行済み。
-- ================================================================

-- 1. 振り直しで値が変わる行を、変更前に退避(既に退避済みの行は上書きしない)
INSERT INTO public.brain_visits_count_at_backup_20261002 (visit_id, customer_id, old_visit_count)
SELECT o.id, o.customer_id, o.visit_count_at
FROM (
  SELECT v.id, v.customer_id, v.visit_count_at,
         row_number() OVER (PARTITION BY v.customer_id ORDER BY v.visit_date, v.created_at, v.id) AS expected
    FROM public.brain_visits v
   WHERE v.deleted_at IS NULL
) o
WHERE o.visit_count_at <> o.expected
ON CONFLICT (visit_id) DO NOTHING;

-- 2. 来店番号がずれている顧客だけ振り直す
SELECT c.customer_id, public.renumber_visits_for_customer(c.customer_id) AS changed_rows
FROM (
  SELECT DISTINCT customer_id FROM public.brain_visits_count_at_backup_20261002
) c;

-- 3. 検証: 0件であること
SELECT count(*) AS still_wrong
FROM (
  SELECT v.visit_count_at,
         row_number() OVER (PARTITION BY v.customer_id ORDER BY v.visit_date, v.created_at, v.id) AS expected
    FROM public.brain_visits v
   WHERE v.deleted_at IS NULL
) x
WHERE x.visit_count_at <> x.expected;
