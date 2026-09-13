-- ================================================================
-- CHECKOUT_ID_FOUNDATION_1 (2026-09-13)
--
-- 背景: docs/architecture/Riora_Management_Dashboard_Architecture_v2.1.md
-- §6-1で明文化した「同日複数会計時のヘッダー上書き問題」の再発防止の土台として、
-- SalonBoard売上明細CSVの会計ID(salonBoardDetailParser.tsのcheckoutId。パース時点では
-- 既に読み取り・集約キーとして使われているが、brain_visitsへの永続化直前で捨てられていた)
-- をbrain_visitsに保持できるようにする。
--
-- スコープ(A案・2026-09-13ユーザー承認): 会計IDを「保持できるようにする」ことが目的。
-- ヘッダーの加算方式や会計単位の複数行構造への変更は別途判断・実装する。
-- 既存378件(過去分)への遡及付与は対象外(元CSVが無いため)→checkout_idはNULLのまま。
--
-- 混在期間の安全性: checkout_idがNULLの行(過去分・staff_input由来)は、CSV取込側の
-- 比較ロジックで「判定不能」として現状の挙動(スキップ)を維持するよう設計しているため、
-- この列追加自体は既存機能に一切影響しない(読み取り側は誰もこの列を参照しない)。
-- ================================================================

ALTER TABLE public.brain_visits ADD COLUMN IF NOT EXISTS checkout_id TEXT NULL;

COMMENT ON COLUMN public.brain_visits.checkout_id IS
  'SalonBoard売上明細CSVの会計ID(salonBoardDetailParser.tsのSalonBoardCheckoutAggregate.checkoutId)。
   CSV取込(salonboard_import/reconciled)由来の行のみ値が入る。staff_input由来の行、および
   本列追加(2026-09-13)より前に取り込まれた過去分はNULL。同一顧客・同一来店日で既存visitが
   存在する場合に、CSV側の会計IDと一致するかどうかで「同一会計の再取込(冪等)」と
   「別の新規会計(現状は未対応のまま検知のみ)」を区別するために使う
   (docs/architecture/Riora_Management_Dashboard_Architecture_v2.1.md §6-1参照)。';

-- insert_visit_with_sequence(MD-5B・20260709_insert_visit_with_sequence_rpc.sql)に
-- p_checkout_idパラメータを追加する。パラメータ数が変わるため、CREATE OR REPLACEでは
-- 別シグネチャの関数が並存してしまう(置き換わらない)。旧シグネチャを明示的にDROPしてから
-- 新シグネチャを作成する。
DROP FUNCTION IF EXISTS public.insert_visit_with_sequence(
  UUID, UUID, UUID, UUID, DATE, BOOLEAN, INTEGER, INTEGER, TEXT,
  BOOLEAN, BOOLEAN, BOOLEAN, TEXT, TEXT, INTEGER, TEXT
);

CREATE FUNCTION public.insert_visit_with_sequence(
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
  p_source              TEXT,
  p_checkout_id         TEXT DEFAULT NULL
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
      no_booking_reason, voice_memo_url, visit_score, source, checkout_id
    )
    VALUES (
      p_store_id, p_customer_id, p_staff_id, p_menu_id, p_visit_date, v_next_seq,
      p_is_nomination, p_treatment_amount, p_retail_amount, p_retail_category,
      p_homecare_purchased, p_homecare_declined, p_next_booking_made,
      p_no_booking_reason, p_voice_memo_url, p_visit_score, p_source, p_checkout_id
    )
    RETURNING *;
END;
$$;

COMMENT ON FUNCTION public.insert_visit_with_sequence IS
  'brain_visitsへ1件追加し、visit_count_atをpg_advisory_xact_lock(顧客単位)配下で
   COALESCE(MAX(visit_count_at),0)+1により原子的に採番する(MD-5B)。呼び出し側は
   visit_count_atを渡さない・計算しない。p_checkout_id(CHECKOUT_ID_FOUNDATION_1)は
   省略可(デフォルトNULL)。書き込み系のためservice_roleのみ実行可。';

-- 最小権限: デフォルトでPUBLICに付与されるEXECUTEを剥奪した上でservice_roleのみ許可する。
REVOKE ALL ON FUNCTION public.insert_visit_with_sequence(
  UUID, UUID, UUID, UUID, DATE, BOOLEAN, INTEGER, INTEGER, TEXT,
  BOOLEAN, BOOLEAN, BOOLEAN, TEXT, TEXT, INTEGER, TEXT, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.insert_visit_with_sequence(
  UUID, UUID, UUID, UUID, DATE, BOOLEAN, INTEGER, INTEGER, TEXT,
  BOOLEAN, BOOLEAN, BOOLEAN, TEXT, TEXT, INTEGER, TEXT, TEXT
) TO service_role;
