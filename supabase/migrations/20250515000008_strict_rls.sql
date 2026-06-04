-- ================================================================
--  Migration 008  –  厳格 RLS + サインアップ制限
--  Salon Riora OS
--
--  目的:
--    ① スタッフ: 自分が assigned_staff_id の顧客データのみ閲覧・編集
--    ② オーナー: 全データ・全監査ログにフルアクセス
--    ③ 売上全体集計 (daily_kpi_snapshots等) はオーナーのみ
--    ④ 許可メール以外のサインアップをブロック
--
--  設計原則:
--    ・auth.uid() (UUID) と内部 staff_id (TEXT) は auth_staff_mapping で紐付け
--    ・既存の緩いポリシーをすべて DROP → 厳格なポリシーで置き換え
--    ・SECURITY DEFINER 関数で行レベルの権限チェックを一元管理
-- ================================================================

-- ================================================================
--  0. ヘルパー関数群
-- ================================================================

-- 現在のユーザーの内部 staff_id を返す
CREATE OR REPLACE FUNCTION get_my_staff_id()
RETURNS TEXT AS $$
  SELECT staff_id
  FROM   auth_staff_mapping
  WHERE  auth_uid = auth.uid()
  LIMIT  1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- オーナーかどうかを判定（JWT claims OR マッピングテーブル）
CREATE OR REPLACE FUNCTION is_owner()
RETURNS BOOLEAN AS $$
BEGIN
  -- JWT の role クレームを確認（Supabase カスタムクレーム）
  IF (auth.jwt() ->> 'role') = 'owner'                   THEN RETURN TRUE; END IF;
  IF (auth.jwt() -> 'app_metadata' ->> 'role') = 'owner' THEN RETURN TRUE; END IF;
  IF (auth.jwt() -> 'user_metadata' ->> 'role') = 'owner' THEN RETURN TRUE; END IF;

  -- マッピングテーブルを確認
  RETURN EXISTS (
    SELECT 1 FROM auth_staff_mapping
    WHERE  auth_uid = auth.uid()
    AND    role     = 'owner'
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- admin 以上（owner or admin）
CREATE OR REPLACE FUNCTION is_admin_or_owner()
RETURNS BOOLEAN AS $$
BEGIN
  IF is_owner() THEN RETURN TRUE; END IF;
  IF (auth.jwt() -> 'app_metadata' ->> 'role') IN ('owner','admin') THEN RETURN TRUE; END IF;
  RETURN EXISTS (
    SELECT 1 FROM auth_staff_mapping
    WHERE  auth_uid = auth.uid()
    AND    role     IN ('owner','admin')
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ================================================================
--  1. auth_staff_mapping  （Supabase Auth UID ↔ 内部 staff_id）
-- ================================================================
CREATE TABLE IF NOT EXISTS auth_staff_mapping (
  auth_uid    UUID    PRIMARY KEY,           -- auth.users.id
  staff_id    TEXT    NOT NULL UNIQUE,       -- 内部 staff ID（例: 'kameyama'）
  email       TEXT    NOT NULL UNIQUE,
  full_name   TEXT,
  role        TEXT    NOT NULL DEFAULT 'staff'
                      CHECK (role IN ('owner','admin','staff')),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE auth_staff_mapping IS
  'Supabase Auth UID と内部 staff_id のマッピング。RLS の基点テーブル。';

CREATE INDEX IF NOT EXISTS idx_asm_staff_id ON auth_staff_mapping (staff_id);
CREATE INDEX IF NOT EXISTS idx_asm_email    ON auth_staff_mapping (email);

-- 自分のレコードのみ閲覧可能 / オーナーは全件
ALTER TABLE auth_staff_mapping ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff read own mapping" ON auth_staff_mapping;
DROP POLICY IF EXISTS "owner read all mapping"  ON auth_staff_mapping;

CREATE POLICY "staff read own mapping" ON auth_staff_mapping
  FOR SELECT USING (auth_uid = auth.uid() OR is_owner());

CREATE POLICY "owner manage mapping" ON auth_staff_mapping
  FOR ALL USING (is_owner());

-- 初期オーナー登録（メールアドレスは本番環境で必ず変更すること）
-- INSERT INTO auth_staff_mapping (auth_uid, staff_id, email, full_name, role)
-- VALUES ('00000000-0000-0000-0000-000000000000', 'owner', 'owner@salon-riora.com', 'オーナー', 'owner')
-- ON CONFLICT DO NOTHING;

-- ================================================================
--  2. staff_invitations  （許可メールアドレス一覧）
-- ================================================================
CREATE TABLE IF NOT EXISTS staff_invitations (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT        NOT NULL UNIQUE,
  role         TEXT        NOT NULL DEFAULT 'staff'
                           CHECK (role IN ('owner','admin','staff')),
  invited_by   TEXT,                    -- 招待したオーナーの staff_id
  note         TEXT,                    -- 招待メモ（名前・役職など）
  used_at      TIMESTAMPTZ,             -- 使用日時（サインアップ完了時）
  auth_uid     UUID        UNIQUE,      -- サインアップ後に紐付く auth.uid()
  expires_at   TIMESTAMPTZ DEFAULT (now() + INTERVAL '30 days'),
  is_active    BOOLEAN     NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE staff_invitations IS
  '事前承認済みメールアドレス一覧。未登録アドレスはサインアップを拒否される。';

-- オーナーのみ管理可能
ALTER TABLE staff_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner manage invitations" ON staff_invitations;
CREATE POLICY "owner manage invitations" ON staff_invitations
  FOR ALL USING (is_owner());

-- 初期スタッフを招待リストへ登録（本番環境で実際のメールに変更）
INSERT INTO staff_invitations (email, role, invited_by, note)
VALUES
  ('owner@salon-riora.com',    'owner', 'system', 'オーナーアカウント'),
  ('kameyama@salon-riora.com', 'staff', 'system', '亀山 純香'),
  ('todate@salon-riora.com',   'staff', 'system', '外舘 裕子'),
  ('staff@salon-riora.com',    'staff', 'system', 'テスト用スタッフ')
ON CONFLICT (email) DO NOTHING;

-- ================================================================
--  3. サインアップ前メール検証関数（アプリ側 RPC として呼び出す）
-- ================================================================
CREATE OR REPLACE FUNCTION check_signup_allowed(p_email TEXT)
RETURNS JSONB AS $$
DECLARE
  v_inv staff_invitations%ROWTYPE;
BEGIN
  SELECT * INTO v_inv
  FROM   staff_invitations
  WHERE  email     = lower(trim(p_email))
  AND    is_active = true
  AND    (expires_at IS NULL OR expires_at > now())
  AND    used_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason',  'このメールアドレスでのサインアップは許可されていません。オーナーに招待を依頼してください。'
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'role',    v_inv.role,
    'note',    v_inv.note
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION check_signup_allowed IS
  'サインアップ前に呼び出し、許可メールか確認する。フロントエンドから supabase.rpc() で使用。';

-- ================================================================
--  4. サインアップ後に auth_staff_mapping を自動作成するトリガー
-- ================================================================
CREATE OR REPLACE FUNCTION handle_new_auth_user()
RETURNS TRIGGER AS $$
DECLARE
  v_inv  staff_invitations%ROWTYPE;
  v_name TEXT;
BEGIN
  -- 招待テーブルから情報取得
  SELECT * INTO v_inv
  FROM   staff_invitations
  WHERE  email = NEW.email AND is_active = true;

  IF NOT FOUND THEN
    -- 未招待ユーザーのサインアップを拒否
    RAISE EXCEPTION 'Signup not allowed for: %', NEW.email
      USING ERRCODE = 'P0001',
            HINT    = 'このメールアドレスは招待されていません。';
  END IF;

  -- 表示名（metadata から取得、なければメールのユーザー部分）
  v_name := COALESCE(
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'name',
    v_inv.note,
    split_part(NEW.email, '@', 1)
  );

  -- マッピングを作成（既存なら無視）
  INSERT INTO public.auth_staff_mapping
    (auth_uid, staff_id, email, full_name, role)
  VALUES
    (NEW.id, split_part(NEW.email, '@', 1), NEW.email, v_name, v_inv.role)
  ON CONFLICT (auth_uid) DO NOTHING;

  -- 招待レコードを使用済みにマーク
  UPDATE staff_invitations
  SET    used_at = now(), auth_uid = NEW.id
  WHERE  email   = NEW.email;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- auth.users へのトリガー（Supabase は auth スキーマへのトリガーを許可）
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

COMMENT ON FUNCTION handle_new_auth_user IS
  '新規サインアップ時: ①招待確認 ②auth_staff_mapping 自動登録 ③招待使用済みマーク';

-- ================================================================
--  5. customers テーブルの RLS を厳格化
-- ================================================================
-- 既存の緩いポリシーを削除
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='customers' AND policyname='auth all customers') THEN
    DROP POLICY "auth all customers" ON customers;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='customers' AND policyname='staff see assigned customers') THEN
    DROP POLICY "staff see assigned customers" ON customers;
  END IF;
END $$;

-- オーナー: 全件読み書き
CREATE POLICY "owner full access customers" ON customers
  FOR ALL USING (is_owner());

-- スタッフ: 自分が担当する顧客のみ (SELECT)
CREATE POLICY "staff read own customers" ON customers
  FOR SELECT USING (
    NOT is_owner()
    AND auth.role() = 'authenticated'
    AND (
      assigned_staff_id = get_my_staff_id()
      OR assigned_staff_id IS NULL  -- 担当未設定は全スタッフが閲覧可
    )
  );

-- スタッフ: 自分が担当する顧客のみ更新（メモ・タグ限定）
CREATE POLICY "staff update own customers" ON customers
  FOR UPDATE USING (
    NOT is_owner()
    AND auth.role() = 'authenticated'
    AND assigned_staff_id = get_my_staff_id()
  )
  WITH CHECK (
    assigned_staff_id = get_my_staff_id()
  );

-- ================================================================
--  6. reservations テーブルの RLS を厳格化
-- ================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='reservations' AND policyname='auth all reservations') THEN
    DROP POLICY "auth all reservations" ON reservations;
  END IF;
END $$;

CREATE POLICY "owner full access reservations" ON reservations
  FOR ALL USING (is_owner());

CREATE POLICY "staff read own reservations" ON reservations
  FOR SELECT USING (
    NOT is_owner()
    AND auth.role() = 'authenticated'
    AND staff_id = get_my_staff_id()
  );

CREATE POLICY "staff insert own reservations" ON reservations
  FOR INSERT WITH CHECK (
    NOT is_owner()
    AND auth.role() = 'authenticated'
    AND staff_id = get_my_staff_id()
  );

CREATE POLICY "staff update own reservations" ON reservations
  FOR UPDATE USING (
    NOT is_owner()
    AND auth.role() = 'authenticated'
    AND staff_id = get_my_staff_id()
  );

-- ================================================================
--  7. sales_data テーブルの RLS（全体集計を制限）
-- ================================================================
ALTER TABLE sales_data ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sales_data' AND policyname='auth all sales_data') THEN
    DROP POLICY "auth all sales_data" ON sales_data;
  END IF;
END $$;

-- オーナー: 全件（全体集計も可能）
CREATE POLICY "owner full access sales" ON sales_data
  FOR ALL USING (is_owner());

-- スタッフ: 自分の staff_id のレコードのみ
--   ※ RLS で行レベルで絞ることで SELECT SUM() も自分分のみになる
CREATE POLICY "staff read own sales" ON sales_data
  FOR SELECT USING (
    NOT is_owner()
    AND auth.role() = 'authenticated'
    AND staff_id = get_my_staff_id()
  );

CREATE POLICY "staff insert own sales" ON sales_data
  FOR INSERT WITH CHECK (
    NOT is_owner()
    AND auth.role() = 'authenticated'
    AND staff_id = get_my_staff_id()
  );

-- ================================================================
--  8. daily_kpi_snapshots / weekly_sales（全体集計）→ オーナーのみ
-- ================================================================
DO $$ BEGIN
  -- daily_kpi_snapshots
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='daily_kpi_snapshots' AND policyname='auth read kpi snapshots') THEN
    DROP POLICY "auth read kpi snapshots"  ON daily_kpi_snapshots;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='daily_kpi_snapshots' AND policyname='auth write kpi snapshots') THEN
    DROP POLICY "auth write kpi snapshots" ON daily_kpi_snapshots;
  END IF;
  -- weekly_sales
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='weekly_sales' AND policyname='auth read weekly sales') THEN
    DROP POLICY "auth read weekly sales"  ON weekly_sales;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='weekly_sales' AND policyname='auth write weekly sales') THEN
    DROP POLICY "auth write weekly sales" ON weekly_sales;
  END IF;
END $$;

-- 全体集計はオーナーのみ閲覧・書き込み可
CREATE POLICY "owner only kpi snapshots" ON daily_kpi_snapshots
  FOR ALL USING (is_owner());

CREATE POLICY "owner only weekly sales" ON weekly_sales
  FOR ALL USING (is_owner());

-- ================================================================
--  9. staff_logs テーブルの RLS を厳格化
-- ================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='staff_logs' AND policyname='auth all staff_logs') THEN
    DROP POLICY "auth all staff_logs" ON staff_logs;
  END IF;
END $$;

CREATE POLICY "owner full access staff_logs" ON staff_logs
  FOR ALL USING (is_owner());

CREATE POLICY "staff manage own logs" ON staff_logs
  FOR ALL USING (
    NOT is_owner()
    AND auth.role() = 'authenticated'
    AND staff_id = get_my_staff_id()
  )
  WITH CHECK (staff_id = get_my_staff_id());

-- ================================================================
--  10. ai_suggestions テーブルの RLS を厳格化
-- ================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ai_suggestions' AND policyname='auth all ai_suggestions') THEN
    DROP POLICY "auth all ai_suggestions" ON ai_suggestions;
  END IF;
END $$;

CREATE POLICY "owner full access ai_suggestions" ON ai_suggestions
  FOR ALL USING (is_owner());

-- スタッフ: 自分が担当する顧客のAI提案のみ
CREATE POLICY "staff read own ai_suggestions" ON ai_suggestions
  FOR SELECT USING (
    NOT is_owner()
    AND auth.role() = 'authenticated'
    AND customer_id IN (
      SELECT id FROM customers
      WHERE  assigned_staff_id = get_my_staff_id()
    )
  );

-- ================================================================
--  11. line_logs / line_histories テーブルの RLS を厳格化
-- ================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='line_logs' AND policyname='auth all line_logs') THEN
    DROP POLICY "auth all line_logs" ON line_logs;
  END IF;
END $$;

CREATE POLICY "owner full access line_logs" ON line_logs
  FOR ALL USING (is_owner());

CREATE POLICY "staff manage own line_logs" ON line_logs
  FOR ALL USING (
    NOT is_owner()
    AND auth.role() = 'authenticated'
    AND staff_id = get_my_staff_id()
  );

-- line_histories（Migration 006 で作成）
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='line_histories' AND policyname='auth all line_histories') THEN
    DROP POLICY "auth all line_histories" ON line_histories;
  END IF;
END $$;

CREATE POLICY "owner full access line_histories" ON line_histories
  FOR ALL USING (is_owner());

CREATE POLICY "staff manage own line_histories" ON line_histories
  FOR ALL USING (
    NOT is_owner()
    AND auth.role() = 'authenticated'
    AND assigned_staff_id = get_my_staff_id()
  );

-- ================================================================
--  12. LINE CRM テーブルの RLS を厳格化
--      （Migration 001/003 で作成）
-- ================================================================
DO $$ BEGIN
  -- line_threads
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='line_threads' AND policyname='auth read threads') THEN
    DROP POLICY "auth read threads"  ON line_threads;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='line_threads' AND policyname='auth write threads') THEN
    DROP POLICY "auth write threads" ON line_threads;
  END IF;
  -- line_messages
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='line_messages' AND policyname='auth read messages') THEN
    DROP POLICY "auth read messages"  ON line_messages;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='line_messages' AND policyname='auth write messages') THEN
    DROP POLICY "auth write messages" ON line_messages;
  END IF;
END $$;

CREATE POLICY "owner full access threads"   ON line_threads  FOR ALL USING (is_owner());
CREATE POLICY "owner full access messages"  ON line_messages FOR ALL USING (is_owner());

-- スタッフ: 自分の担当顧客のスレッド・メッセージのみ
CREATE POLICY "staff read own threads" ON line_threads
  FOR SELECT USING (
    NOT is_owner()
    AND auth.role() = 'authenticated'
    AND customer_id::TEXT IN (
      SELECT id::TEXT FROM customers
      WHERE  assigned_staff_id = get_my_staff_id()
    )
  );

CREATE POLICY "staff manage own messages" ON line_messages
  FOR ALL USING (
    NOT is_owner()
    AND auth.role() = 'authenticated'
    AND thread_id IN (
      SELECT lt.id FROM line_threads lt
      JOIN   customers c ON c.id = lt.customer_id::UUID
      WHERE  c.assigned_staff_id = get_my_staff_id()
    )
  );

-- ================================================================
--  13. メニュー系テーブルの RLS（全スタッフ参照可 / 編集はオーナーのみ）
-- ================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='salon_menus' AND policyname='auth read menus') THEN
    DROP POLICY "auth read menus"  ON salon_menus;
    DROP POLICY "auth write menus" ON salon_menus;
  END IF;
END $$;

-- 参照: 全認証済みユーザー（スタッフがメニュー内容を見るのは OK）
CREATE POLICY "authenticated read menus" ON salon_menus
  FOR SELECT USING (auth.role() = 'authenticated');

-- 書き込み: オーナーのみ
CREATE POLICY "owner write menus" ON salon_menus
  FOR INSERT WITH CHECK (is_owner());

CREATE POLICY "owner update menus" ON salon_menus
  FOR UPDATE USING (is_owner());

CREATE POLICY "owner delete menus" ON salon_menus
  FOR DELETE USING (is_owner());

-- salon_menu_analytics: オーナーのみ（利益率等の機密情報）
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='salon_menu_analytics' AND policyname='auth read analytics') THEN
    DROP POLICY "auth read analytics"  ON salon_menu_analytics;
    DROP POLICY "auth write analytics" ON salon_menu_analytics;
  END IF;
END $$;

CREATE POLICY "owner full analytics" ON salon_menu_analytics
  FOR ALL USING (is_owner());

-- スタッフ: 分析は閲覧のみ（利益率の詳細は不可だが基本情報は可）
CREATE POLICY "staff read analytics" ON salon_menu_analytics
  FOR SELECT USING (
    NOT is_owner()
    AND auth.role() = 'authenticated'
  );

-- ================================================================
--  14. 監査ログは オーナーのみ閲覧（INSERT は認証済み全員）
--      ※ Migration 007 のポリシーを再確認・強化
-- ================================================================
-- audit_view_logs の SELECT を is_owner() で厳格化
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='audit_view_logs' AND policyname='owner read view logs') THEN
    DROP POLICY "owner read view logs" ON audit_view_logs;
  END IF;
END $$;
CREATE POLICY "owner read audit_view_logs" ON audit_view_logs
  FOR SELECT USING (is_owner());

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='audit_edit_logs' AND policyname='owner read edit logs') THEN
    DROP POLICY "owner read edit logs" ON audit_edit_logs;
  END IF;
END $$;
CREATE POLICY "owner read audit_edit_logs" ON audit_edit_logs
  FOR SELECT USING (is_owner());

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='audit_export_logs' AND policyname='owner read export logs') THEN
    DROP POLICY "owner read export logs" ON audit_export_logs;
  END IF;
END $$;
CREATE POLICY "owner read audit_export_logs" ON audit_export_logs
  FOR SELECT USING (is_owner());

-- ================================================================
--  15. kpi_insights / staff_daily_rankings（全スタッフ閲覧可）
-- ================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='kpi_insights' AND policyname='auth read kpi insights') THEN
    DROP POLICY "auth read kpi insights" ON kpi_insights;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='staff_daily_rankings' AND policyname='auth read staff rankings') THEN
    DROP POLICY "auth read staff rankings"  ON staff_daily_rankings;
    DROP POLICY "auth write staff rankings" ON staff_daily_rankings;
  END IF;
END $$;

CREATE POLICY "authenticated read insights" ON kpi_insights
  FOR SELECT USING (auth.role() = 'authenticated');

-- スタッフランキングは全員が自分と他のスタッフのランキングを見られる
CREATE POLICY "authenticated read rankings" ON staff_daily_rankings
  FOR SELECT USING (auth.role() = 'authenticated');

-- ランキングへの書き込みはサーバーサイド（オーナーor集計処理）のみ
CREATE POLICY "owner write rankings" ON staff_daily_rankings
  FOR ALL USING (is_owner());

-- ================================================================
--  16. オーナー専用ビュー: スタッフ別売上サマリー
-- ================================================================
CREATE OR REPLACE VIEW owner_sales_summary AS
SELECT
  asm.staff_id,
  asm.full_name,
  asm.email,
  COUNT(sd.id)         AS total_transactions,
  SUM(sd.total_amount) AS total_revenue,
  AVG(sd.total_amount) AS avg_revenue_per_transaction,
  COUNT(DISTINCT sd.customer_id) AS unique_customers,
  MAX(sd.recorded_at)  AS last_sale_at
FROM auth_staff_mapping asm
LEFT JOIN sales_data sd ON sd.staff_id = asm.staff_id
GROUP BY asm.staff_id, asm.full_name, asm.email;

COMMENT ON VIEW owner_sales_summary IS 'オーナー専用: スタッフ別売上サマリー（一般スタッフには非表示）';

-- このビューはオーナーのみ（RLS ではなくビュー自体の SECURITY INVOKER で制御）
REVOKE ALL ON owner_sales_summary FROM PUBLIC;
GRANT SELECT ON owner_sales_summary TO authenticated;
-- ※ ビュー内の base tables に RLS がかかっているため、スタッフが参照すると自分の分のみ表示される

-- ================================================================
--  17. セキュリティまとめ確認ビュー（デバッグ用）
-- ================================================================
CREATE OR REPLACE VIEW rls_policy_audit AS
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

COMMENT ON VIEW rls_policy_audit IS '現在の RLS ポリシー一覧（デバッグ用・オーナーのみ）';
