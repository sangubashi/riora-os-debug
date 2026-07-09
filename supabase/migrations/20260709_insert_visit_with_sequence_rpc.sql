-- ================================================================
-- Riora OS: brain_visits.visit_count_at の原子的採番RPC(MD-5B)
--
-- 背景(MD-2〜MD-5A):
--   src/lib/import/csvImportPipeline.ts / app/api/visits/route.ts が
--   `countByCustomer()`(COUNT読み取り) → `+1` → `create()`(INSERT) という
--   非原子パターンでvisit_count_atを採番していたため、同一顧客への複数回の
--   別インポート実行・同時リクエストが競合すると同じvisit_count_atが
--   重複/前後する不整合が発生した(実データで6顧客7行の不整合を確認・
--   MD-4でバックフィル済み)。
--
--   本migrationはDB側でCOUNT読み取り+INSERTを1トランザクション・
--   pg_advisory_xact_lockによる顧客単位の直列化のもとで原子的に行う
--   RPC関数を追加する(再発防止・恒久対策)。
--
-- 採番方式: COUNT(*)+1 ではなく COALESCE(MAX(visit_count_at),0)+1 を採用。
--   理由: 将来的なデータ補正・移行・バックフィルにより該当顧客の来店行数と
--   最大visit_count_atが一致しなくなるケース(欠番・論理削除等)があっても、
--   常に「現在の最大値+1」を採番することで連番の単調増加を保証するため。
--
-- 呼び出し側(src/lib/import/csvImportPipeline.ts / app/api/visits/route.ts)の
-- 切り替えはMD-5C以降で別途実施する。本migrationは関数追加のみで、
-- 既存の呼び出し経路(VisitRepo.create()+countByCustomer())には一切影響しない
-- (非破壊: 関数を追加するだけでは何も壊れない)。
--
-- 権限方針: 書き込み系RPCのため、get_customer_stats(読み取り専用・
-- authenticated許可)とは異なり、PUBLICへのEXECUTEをREVOKEした上で
-- service_roleのみに許可する(anon/authenticatedからのPostgREST経由の
-- 直接呼び出しを禁止する)。アプリは常にSUPABASE_SERVICE_ROLE_KEYで
-- 接続するため(app/lib/repos.ts:getClient())、これで実運用に支障はない。
-- ================================================================

CREATE OR REPLACE FUNCTION public.insert_visit_with_sequence(
  p_store_id           UUID,
  p_customer_id        UUID,
  p_staff_id           UUID,
  p_menu_id            UUID,
  p_visit_date         DATE,
  p_is_nomination       BOOLEAN,
  p_treatment_amount    INTEGER,
  p_retail_amount       INTEGER,
  p_retail_category     TEXT,
  p_homecare_purchased  BOOLEAN,
  p_homecare_declined   BOOLEAN,
  p_next_booking_made   BOOLEAN,
  p_no_booking_reason   TEXT,
  p_voice_memo_url      TEXT,
  p_visit_score         INTEGER,
  p_source              TEXT
)
RETURNS SETOF public.brain_visits
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next_seq INTEGER;
BEGIN
  -- 同一customer_idへの同時呼び出しを直列化する(トランザクション終了時に自動解放)。
  PERFORM pg_advisory_xact_lock(hashtext(p_customer_id::text));

  -- COUNT(*)+1ではなくMAX(visit_count_at)+1を採用(将来のデータ補正後も単調増加を保証)。
  SELECT COALESCE(MAX(v.visit_count_at), 0) + 1
    INTO v_next_seq
    FROM public.brain_visits v
    WHERE v.customer_id = p_customer_id
      AND v.deleted_at IS NULL;

  RETURN QUERY
    INSERT INTO public.brain_visits (
      store_id, customer_id, staff_id, menu_id, visit_date, visit_count_at,
      is_nomination, treatment_amount, retail_amount, retail_category,
      homecare_purchased, homecare_declined, next_booking_made,
      no_booking_reason, voice_memo_url, visit_score, source
    )
    VALUES (
      p_store_id, p_customer_id, p_staff_id, p_menu_id, p_visit_date, v_next_seq,
      p_is_nomination, p_treatment_amount, p_retail_amount, p_retail_category,
      p_homecare_purchased, p_homecare_declined, p_next_booking_made,
      p_no_booking_reason, p_voice_memo_url, p_visit_score, p_source
    )
    RETURNING *;
END;
$$;

COMMENT ON FUNCTION public.insert_visit_with_sequence IS
  'brain_visitsへ1件追加し、visit_count_atをpg_advisory_xact_lock(顧客単位)配下で
   COALESCE(MAX(visit_count_at),0)+1により原子的に採番する(MD-5B)。呼び出し側は
   visit_count_atを渡さない・計算しない。書き込み系のためservice_roleのみ実行可。';

-- 最小権限: デフォルトでPUBLICに付与されるEXECUTEを剥奪した上でservice_roleのみ許可する。
REVOKE ALL ON FUNCTION public.insert_visit_with_sequence(
  UUID, UUID, UUID, UUID, DATE, BOOLEAN, INTEGER, INTEGER, TEXT,
  BOOLEAN, BOOLEAN, BOOLEAN, TEXT, TEXT, INTEGER, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.insert_visit_with_sequence(
  UUID, UUID, UUID, UUID, DATE, BOOLEAN, INTEGER, INTEGER, TEXT,
  BOOLEAN, BOOLEAN, BOOLEAN, TEXT, TEXT, INTEGER, TEXT
) TO service_role;
