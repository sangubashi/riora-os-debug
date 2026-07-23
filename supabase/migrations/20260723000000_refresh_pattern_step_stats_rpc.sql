-- ================================================================
-- Riora OS: brain_pattern_step_stats(マテリアライズドビュー)の
-- REFRESH用RPC関数(Phase 1-Cc)
--
-- 背景:
--   brain_pattern_step_statsはbrain_proposal_outcomesを集計するマテビュー
--   (supabase/migrations/20260612000008_w8_pattern_engine.sql)だが、
--   元テーブルへのINSERTだけでは自動更新されない。REFRESH MATERIALIZED
--   VIEWはSupabase-js(PostgREST)からは直接発行できず(テーブル操作か
--   事前定義RPCの呼び出ししか許可されていない)、既存のinsert_visit_with_
--   sequence(supabase/migrations/20260709_insert_visit_with_sequence_rpc.sql)
--   と同じ理由でRPC関数として包む必要がある(Phase 1-Cc調査で確認済み)。
--
-- CONCURRENTLY使用条件: brain_pattern_step_stats自体に既にUNIQUE INDEX
--   (idx_brain_pattern_step_stats_cell、20260612000008で作成済み)が
--   存在するため、追加のインデックス作成は不要。
--
-- 権限方針: 書き込み系(マテビューの再計算)のRPCのため、
--   insert_visit_with_sequenceと同じくPUBLICへのEXECUTEをREVOKEした上で
--   service_roleのみに許可する(アプリは常にSUPABASE_SERVICE_ROLE_KEYで
--   接続するため実運用に支障はない)。
-- ================================================================

CREATE OR REPLACE FUNCTION public.refresh_pattern_step_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.brain_pattern_step_stats;
END;
$$;

COMMENT ON FUNCTION public.refresh_pattern_step_stats IS
  'brain_pattern_step_stats(brain_proposal_outcomes集計マテビュー)をCONCURRENTLY
   再計算する(Phase 1-Cc)。CSV取込完了後、outcomeが1件以上作成された場合のみ
   呼び出される想定(csvImportPipeline.ts)。書き込み系のためservice_roleのみ実行可。';

-- 最小権限: デフォルトでPUBLICに付与されるEXECUTEを剥奪した上でservice_roleのみ許可する。
REVOKE ALL ON FUNCTION public.refresh_pattern_step_stats() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.refresh_pattern_step_stats() TO service_role;
