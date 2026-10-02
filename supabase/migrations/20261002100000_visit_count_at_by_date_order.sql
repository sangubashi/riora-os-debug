-- ================================================================
-- brain_visits.visit_count_at を「取込順」ではなく「来店日昇順」で採番する(2026-10-02)
--
-- 背景: insert_visit_with_sequence は COALESCE(MAX(visit_count_at),0)+1 で採番していたため、
--   過去日付のCSV(例: 4月分を後から取込)を取り込むと、過去の来店に大きい番号が付き
--   「来店1回目」が最新になる等、日付順と番号が逆転していた(25人・92件で確認)。
--
-- 変更:
--   1. renumber_visits_for_customer(customer_id): 顧客の有効な来店を
--      (visit_date, created_at, id) の昇順で 1,2,3… に振り直す。顧客単位のadvisory lock配下。
--      同日複数会計は created_at → id の順で安定して並ぶ。冪等(何度実行しても同じ結果)。
--   2. insert_visit_with_sequence: シグネチャ・戻り値は従来と同一のまま、INSERT後に上記で
--      振り直し、振り直し後の行を返す。呼び出し側(VisitRepo.createSequenced)は変更不要。
--   3. 一括修復用の退避テーブル(RLS有効・ポリシーなし=service_roleのみ)。
--
-- brain_proposal_outcomes / brain_events が持つ visit_count_at は「その時点のスナップショット」
-- のため、ここでは変更しない。
-- ================================================================

CREATE OR REPLACE FUNCTION public.renumber_visits_for_customer(p_customer_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_changed integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_customer_id::text));

  WITH ordered AS (
    SELECT v.id,
           row_number() OVER (ORDER BY v.visit_date, v.created_at, v.id) AS rn
      FROM public.brain_visits v
     WHERE v.customer_id = p_customer_id
       AND v.deleted_at IS NULL
  )
  UPDATE public.brain_visits v
     SET visit_count_at = o.rn
    FROM ordered o
   WHERE v.id = o.id
     AND v.visit_count_at IS DISTINCT FROM o.rn;

  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed;
END;
$$;

COMMENT ON FUNCTION public.renumber_visits_for_customer(uuid) IS
  '顧客の有効な来店(deleted_at IS NULL)を visit_date, created_at, id の昇順で visit_count_at=1,2,3… に振り直す。冪等。変更した行数を返す。書き込み系のためservice_roleのみ実行可。';

REVOKE ALL ON FUNCTION public.renumber_visits_for_customer(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.renumber_visits_for_customer(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.insert_visit_with_sequence(
  p_store_id uuid, p_customer_id uuid, p_staff_id uuid, p_menu_id uuid, p_visit_date date,
  p_is_nomination boolean, p_treatment_amount integer, p_retail_amount integer, p_retail_category text,
  p_homecare_purchased boolean, p_homecare_declined boolean, p_next_booking_made boolean,
  p_no_booking_reason text, p_voice_memo_url text, p_visit_score integer, p_source text,
  p_checkout_id text DEFAULT NULL::text
)
RETURNS SETOF brain_visits
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_next_seq INTEGER;
  v_id       UUID;
BEGIN
  -- 同一customer_idへの同時呼び出しを直列化する(トランザクション終了時に自動解放)。
  PERFORM pg_advisory_xact_lock(hashtext(p_customer_id::text));

  -- 仮番号(末尾)で挿入し、直後に来店日昇順で全体を振り直す(CHECK >= 1 を満たすため)。
  SELECT COALESCE(MAX(v.visit_count_at), 0) + 1
    INTO v_next_seq
    FROM public.brain_visits v
    WHERE v.customer_id = p_customer_id
      AND v.deleted_at IS NULL;

  INSERT INTO public.brain_visits (
    store_id, customer_id, staff_id, menu_id, visit_date, visit_count_at,
    is_nomination, treatment_amount, retail_amount, retail_category,
    homecare_purchased, homecare_declined, next_booking_made,
    no_booking_reason, voice_memo_url, visit_score, source, checkout_id
  )
  VALUES (
    p_store_id, p_customer_id, p_staff_id, p_menu_id, p_visit_date, v_next_seq,
    p_is_nomination, p_treatment_amount, p_retail_amount, p_retail_category,
    p_homecare_purchased, p_homecare_declined, p_next_booking_made,
    p_no_booking_reason, p_voice_memo_url, p_visit_score, p_source, p_checkout_id
  )
  RETURNING id INTO v_id;

  PERFORM public.renumber_visits_for_customer(p_customer_id);

  RETURN QUERY SELECT * FROM public.brain_visits WHERE id = v_id;
END;
$function$;

-- 一括修復前の値の退避(戻す必要が出た場合に備える)。service_role以外は不可(RLS有効・ポリシーなし)。
CREATE TABLE IF NOT EXISTS public.brain_visits_count_at_backup_20261002 (
  visit_id        uuid PRIMARY KEY,
  customer_id     uuid NOT NULL,
  old_visit_count integer NOT NULL,
  backed_up_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.brain_visits_count_at_backup_20261002 ENABLE ROW LEVEL SECURITY;
