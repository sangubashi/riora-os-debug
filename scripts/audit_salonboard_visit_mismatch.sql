-- ================================================================
-- サロンボードの「来店回数(salonboard_visit_count)」とRiora OSの来店履歴の不一致を点検する
-- (読み取り専用・何も書き込まない。2026-10-02作成)
--
-- 不一致の理由を3つに分類して出す:
--   data_gap_before_import : 来店データの取込開始日(最古のbrain_visits)より前の来店がある
--                            (サロンボードの初回来店日が取込範囲より前) → 元CSVの取込が必要
--   subscription_pay_days  : 「サブスク決済日」だけで来店(施術)ではない日。brain_subscription_payments
--                            に保存され、brain_visitsには入れない仕様(SUBSCRIPTION_VISIT_SPLIT_PHASE1)。
--                            サロンボードはこれも1回と数えるため、その分だけ多くなる
--   stale_snapshot         : 上記で説明できない差。貼り付けた時点以降に来店が増えた/減った等
-- ================================================================
with data_start as (
  select min(visit_date) as d from public.brain_visits where deleted_at is null
),
t as (
  select
    c.id, c.name, c.first_visit_date, c.salonboard_visit_count as sb,
    (select count(*) from public.brain_visits v
       where v.customer_id = c.id and v.deleted_at is null) as visits,
    (select count(distinct p.payment_date) from public.brain_subscription_payments p
       where p.customer_id = c.id and p.deleted_at is null
         and not exists (select 1 from public.brain_visits v
                           where v.customer_id = c.id and v.visit_date = p.payment_date
                             and v.deleted_at is null)) as sub_pay_days
  from public.brain_customers c
  where c.deleted_at is null and c.salonboard_visit_count is not null
)
select
  t.name, t.first_visit_date, t.sb as salonboard_count, t.visits as riora_visits,
  t.sub_pay_days, (t.sb - t.visits) as diff,
  case
    when t.sb = t.visits then 'ok'
    when t.first_visit_date < (select d from data_start) and t.sb > t.visits then 'data_gap_before_import'
    when t.sb > t.visits and t.sb <= t.visits + t.sub_pay_days then 'subscription_pay_days'
    else 'stale_snapshot'
  end as reason
from t
order by (t.sb = t.visits), t.name;
