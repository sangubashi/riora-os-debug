-- ================================================================
-- 2026-06-23: DashboardAggregator向け visit_count 列追加
--
-- 背景: 画面①経営TOPの対象KPIに「来店人数」が追加されたが、
-- brain_dashboard_dailyにはW19(20260620)時点で対応する列が無い。
-- 新規業務テーブルは作らず、既存brain_dashboard_dailyへのALTER TABLEのみで
-- 対応する(W19と同じ制約を継承)。
--
-- 集計粒度: monthly_salesと同じ「月初からsnapshot_dateまでの累計(MTD)」。
-- 「人数」なので来店件数(visits行数)ではなく、その期間に来店した
-- ユニーク顧客数(distinct customer_id)を格納する(DashboardAggregator.ts参照)。
-- ================================================================

ALTER TABLE public.brain_dashboard_daily
  ADD COLUMN IF NOT EXISTS visit_count integer;

COMMENT ON COLUMN public.brain_dashboard_daily.visit_count IS
  '当月の来店人数(月初からsnapshot_dateまでのMTD累計・ユニーク顧客数)。'
  'monthly_salesと同じMTD粒度。DashboardAggregatorが生成。';
