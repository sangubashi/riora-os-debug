-- ================================================================
--  Salon Riora OS – スタッフ紐付け一括修正スクリプト
--  Supabase Dashboard > SQL Editor に貼り付けて実行
--
--  対象スタッフ: test-staff@salon-riora.jp
--  auth.uid    : ae68433d-69ce-4dc3-a38e-cc2501895fee
-- ================================================================

DO $$
DECLARE
  v_uid       UUID    := 'ae68433d-69ce-4dc3-a38e-cc2501895fee';
  v_staff_id  TEXT    := 'test-staff';
  v_email     TEXT    := 'test-staff@salon-riora.jp';
  v_name      TEXT    := 'テストスタッフ';
  v_updated   INT;
BEGIN

  RAISE NOTICE '=== Salon Riora スタッフ紐付け修正スクリプト ===';
  RAISE NOTICE 'auth.uid : %', v_uid;
  RAISE NOTICE 'staff_id : %', v_staff_id;

  -- ────────────────────────────────────────────────────────────────
  -- 1. staff_invitations（signup 許可リスト）
  -- ────────────────────────────────────────────────────────────────
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_name = 'staff_invitations' AND table_schema = 'public') THEN

    INSERT INTO public.staff_invitations (email, role, invited_by, note, is_active)
    VALUES (v_email, 'staff', 'system', 'テスト用スタッフ', true)
    ON CONFLICT (email) DO UPDATE
      SET role = 'staff', is_active = true, used_at = now(), auth_uid = v_uid;

    RAISE NOTICE '[1] staff_invitations: OK';
  ELSE
    RAISE NOTICE '[1] staff_invitations: テーブルなし（スキップ）';
  END IF;

  -- ────────────────────────────────────────────────────────────────
  -- 2. profiles（001_schema.sql の UUID FK 方式）
  -- ────────────────────────────────────────────────────────────────
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_name = 'profiles' AND table_schema = 'public') THEN

    INSERT INTO public.profiles (id, role, staff_name, display_name)
    VALUES (v_uid, 'staff', v_name, v_staff_id)
    ON CONFLICT (id) DO UPDATE
      SET role = 'staff', staff_name = v_name;

    RAISE NOTICE '[2] profiles: OK';
  ELSE
    RAISE NOTICE '[2] profiles: テーブルなし（スキップ）';
  END IF;

  -- ────────────────────────────────────────────────────────────────
  -- 3. auth_staff_mapping（migration 008 の UUID↔TEXT マッピング）
  -- ────────────────────────────────────────────────────────────────
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_name = 'auth_staff_mapping' AND table_schema = 'public') THEN

    INSERT INTO public.auth_staff_mapping
      (auth_uid, staff_id, email, full_name, role, is_active)
    VALUES
      (v_uid, v_staff_id, v_email, v_name, 'staff', true)
    ON CONFLICT (auth_uid) DO UPDATE
      SET staff_id = v_staff_id, email = v_email,
          full_name = v_name, role = 'staff', is_active = true;

    RAISE NOTICE '[3] auth_staff_mapping: OK (staff_id = %)', v_staff_id;
  ELSE
    RAISE NOTICE '[3] auth_staff_mapping: テーブルなし（スキップ）';
  END IF;

  -- ────────────────────────────────────────────────────────────────
  -- 4. customers.assigned_staff_id
  --    UUID 型と TEXT 型の両方に対応（型に応じてキャスト）
  -- ────────────────────────────────────────────────────────────────
  DECLARE
    v_col_type TEXT;
  BEGIN
    SELECT data_type INTO v_col_type
    FROM information_schema.columns
    WHERE table_name = 'customers'
      AND column_name = 'assigned_staff_id'
      AND table_schema = 'public';

    IF v_col_type = 'uuid' THEN
      -- UUID 型カラム → UUID でセット
      EXECUTE format(
        'UPDATE public.customers SET assigned_staff_id = %L::uuid',
        v_uid
      );
      GET DIAGNOSTICS v_updated = ROW_COUNT;
      RAISE NOTICE '[4] customers.assigned_staff_id (UUID型) → % 件更新', v_updated;

    ELSIF v_col_type IN ('text', 'character varying') THEN
      -- TEXT 型カラム → staff_id 文字列でセット
      EXECUTE format(
        'UPDATE public.customers SET assigned_staff_id = %L',
        v_staff_id
      );
      GET DIAGNOSTICS v_updated = ROW_COUNT;
      RAISE NOTICE '[4] customers.assigned_staff_id (TEXT型) → % 件更新', v_updated;

    ELSE
      RAISE NOTICE '[4] customers.assigned_staff_id: カラム不明（スキップ）type=%', v_col_type;
    END IF;
  END;

  -- ────────────────────────────────────────────────────────────────
  -- 5. reservations.staff_id
  -- ────────────────────────────────────────────────────────────────
  DECLARE
    v_res_col TEXT;
  BEGIN
    SELECT data_type INTO v_res_col
    FROM information_schema.columns
    WHERE table_name = 'reservations'
      AND column_name = 'staff_id'
      AND table_schema = 'public';

    IF v_res_col = 'uuid' THEN
      EXECUTE format(
        'UPDATE public.reservations SET staff_id = %L::uuid',
        v_uid
      );
    ELSE
      EXECUTE format(
        'UPDATE public.reservations SET staff_id = %L',
        v_staff_id
      );
    END IF;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RAISE NOTICE '[5] reservations.staff_id (%型) → % 件更新', v_res_col, v_updated;
  END;

  -- ────────────────────────────────────────────────────────────────
  -- 6. staff_logs.staff_id
  -- ────────────────────────────────────────────────────────────────
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_name = 'staff_logs' AND table_schema = 'public') THEN

    DECLARE v_sl_col TEXT;
    BEGIN
      SELECT data_type INTO v_sl_col
      FROM information_schema.columns
      WHERE table_name = 'staff_logs'
        AND column_name = 'staff_id'
        AND table_schema = 'public';

      IF v_sl_col = 'uuid' THEN
        EXECUTE format('UPDATE public.staff_logs SET staff_id = %L::uuid', v_uid);
      ELSE
        EXECUTE format('UPDATE public.staff_logs SET staff_id = %L', v_staff_id);
      END IF;
      GET DIAGNOSTICS v_updated = ROW_COUNT;
      RAISE NOTICE '[6] staff_logs.staff_id (%型) → % 件更新', v_sl_col, v_updated;
    END;
  END IF;

  -- ────────────────────────────────────────────────────────────────
  -- 7. sales_data.staff_id（TEXT 型）
  -- ────────────────────────────────────────────────────────────────
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_name = 'sales_data' AND table_schema = 'public') THEN

    UPDATE public.sales_data SET staff_id = v_staff_id::TEXT;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RAISE NOTICE '[7] sales_data.staff_id → % 件更新', v_updated;
  ELSE
    RAISE NOTICE '[7] sales_data: テーブルなし（スキップ）';
  END IF;

  -- ────────────────────────────────────────────────────────────────
  -- 8. line_logs.staff_id
  -- ────────────────────────────────────────────────────────────────
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_name = 'line_logs' AND table_schema = 'public') THEN

    DECLARE v_ll_col TEXT;
    BEGIN
      SELECT data_type INTO v_ll_col
      FROM information_schema.columns
      WHERE table_name = 'line_logs'
        AND column_name = 'staff_id'
        AND table_schema = 'public';

      IF v_ll_col = 'uuid' THEN
        EXECUTE format('UPDATE public.line_logs SET staff_id = %L::uuid', v_uid);
      ELSE
        EXECUTE format('UPDATE public.line_logs SET staff_id = %L', v_staff_id);
      END IF;
      GET DIAGNOSTICS v_updated = ROW_COUNT;
      RAISE NOTICE '[8] line_logs.staff_id (%型) → % 件更新', v_ll_col, v_updated;
    END;
  END IF;

  -- ────────────────────────────────────────────────────────────────
  -- 9. line_histories.assigned_staff_id（TEXT 型）
  -- ────────────────────────────────────────────────────────────────
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_name = 'line_histories' AND table_schema = 'public') THEN

    UPDATE public.line_histories SET assigned_staff_id = v_staff_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RAISE NOTICE '[9] line_histories.assigned_staff_id → % 件更新', v_updated;
  END IF;

  -- ────────────────────────────────────────────────────────────────
  -- 10. customers.visit_count / total_spent を reservations から集計
  -- ────────────────────────────────────────────────────────────────
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'reservations' AND column_name = 'price' AND table_schema = 'public'
  ) THEN
    UPDATE public.customers c
    SET
      visit_count = COALESCE(sub.cnt,   0),
      total_spent = COALESCE(sub.total, 0)
    FROM (
      SELECT
        customer_id,
        COUNT(*)                        AS cnt,
        SUM(COALESCE(price, 0))         AS total
      FROM public.reservations
      WHERE status = 'completed'
        AND customer_id IS NOT NULL
      GROUP BY customer_id
    ) sub
    WHERE c.id = sub.customer_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RAISE NOTICE '[10] customers visit_count/total_spent 集計更新: % 件', v_updated;
  ELSE
    RAISE NOTICE '[10] reservations.price カラムなし（visit_count/total_spent はスキップ）';
  END IF;

  -- ────────────────────────────────────────────────────────────────
  -- 確認レポート
  -- ────────────────────────────────────────────────────────────────
  RAISE NOTICE '=== 完了レポート ===';

  DECLARE
    v_cust_total  INT;
    v_cust_staff  INT;
    v_res_total   INT;
    v_visit_avg   NUMERIC;
  BEGIN
    SELECT COUNT(*) INTO v_cust_total FROM public.customers;
    SELECT COUNT(*) INTO v_cust_staff FROM public.customers
      WHERE assigned_staff_id IS NOT NULL
        AND assigned_staff_id::TEXT != '';
    SELECT COUNT(*) INTO v_res_total  FROM public.reservations;
    SELECT AVG(visit_count) INTO v_visit_avg FROM public.customers WHERE visit_count > 0;

    RAISE NOTICE 'customers 総数:           %', v_cust_total;
    RAISE NOTICE 'assigned_staff_id 設定済: %', v_cust_staff;
    RAISE NOTICE 'reservations 総数:        %', v_res_total;
    RAISE NOTICE 'visit_count 平均 (>0):    %', ROUND(v_visit_avg, 1);
  END;

END $$;

-- ================================================================
--  個別確認クエリ（実行後に確認）
-- ================================================================
SELECT 'customers' AS tbl, COUNT(*) AS total,
  COUNT(NULLIF(assigned_staff_id::TEXT,'')) AS with_staff,
  AVG(visit_count)::INT AS avg_visit,
  AVG(total_spent)::INT AS avg_spent
FROM public.customers

UNION ALL

SELECT 'reservations', COUNT(*), 0, 0, 0
FROM public.reservations;
