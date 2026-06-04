-- Migration: PHASE 4 — NextAction action_type 追加
-- 実行場所: Supabase Dashboard > SQL Editor

-- ─── action_logs CHECK 制約更新 ─────────────────────────────────────────────
ALTER TABLE public.customer_action_logs
  DROP CONSTRAINT IF EXISTS chk_action_type;

ALTER TABLE public.customer_action_logs
  ADD CONSTRAINT chk_action_type CHECK (
    action_type IN (
      'line_sent',
      'homecare_explained',
      'rebook_recommended',
      'product_recommended',
      'product_purchased',
      'voice_note_created',
      'voice_insight_generated',
      'next_action_line',
      'next_action_rebook',
      'next_action_product',
      'next_action_vip',
      'next_action_homecare',
      'next_action_inactive'
    )
  );

-- ─── NextAction 実施率集計ビュー ─────────────────────────────────────────────
-- 提案実行率・フォロー実行率をリアルタイム集計
CREATE OR REPLACE VIEW public.next_action_execution_rate AS
SELECT
  DATE_TRUNC('day', created_at AT TIME ZONE 'Asia/Tokyo') AS log_date,
  staff_id,
  -- LINE実施率
  COUNT(*) FILTER (WHERE action_type = 'next_action_line')     AS line_executed,
  -- 再来提案実施率
  COUNT(*) FILTER (WHERE action_type = 'next_action_rebook')   AS rebook_executed,
  -- 商品提案実施率
  COUNT(*) FILTER (WHERE action_type = 'next_action_product')  AS product_executed,
  -- VIPフォロー実施率
  COUNT(*) FILTER (WHERE action_type = 'next_action_vip')      AS vip_executed,
  -- ホームケアフォロー実施率
  COUNT(*) FILTER (WHERE action_type = 'next_action_homecare') AS homecare_executed,
  -- 離脱リスク対応実施率
  COUNT(*) FILTER (WHERE action_type = 'next_action_inactive') AS inactive_executed,
  -- 合計
  COUNT(*)                                                       AS total_executed
FROM public.customer_action_logs
WHERE action_type LIKE 'next_action_%'
GROUP BY 1, 2
ORDER BY 1 DESC, 2;

-- 確認:
-- SELECT * FROM public.next_action_execution_rate ORDER BY log_date DESC LIMIT 20;
