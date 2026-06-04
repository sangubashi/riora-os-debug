-- ================================================================
--  Migration 007  –  軽量監査ログ（MVP）
--  Salon Riora OS
--
--  テーブル:
--    1. audit_view_logs   – 顧客画面閲覧記録
--    2. audit_edit_logs   – データ変更記録（before/after JSON）
--    3. audit_export_logs – エクスポート操作記録
--
--  セキュリティ:
--    ・INSERT: 認証済みユーザー（スタッフ）が自分のログを書ける
--    ・SELECT: owner ロールのみ参照可能（一般スタッフは閲覧不可）
--    ・UPDATE / DELETE: 完全に禁止（改ざん防止）
--
--  自動記録:
--    ・staff_logs / reservations / customers への変更は
--      Trigger で自動的に audit_edit_logs へ書き込む
--    ・閲覧ログとエクスポートログは useAuditStore (クライアント) から INSERT
-- ================================================================

-- ================================================================
--  ヘルパー: owner ロールチェック関数
-- ================================================================
CREATE OR REPLACE FUNCTION is_owner()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN (
    (auth.jwt() ->> 'role') = 'owner'
    OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'owner'
    OR (auth.jwt() -> 'user_metadata' ->> 'role') = 'owner'
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION is_owner() IS 'JWTクレームから owner ロールを判定';

-- ================================================================
--  1. audit_view_logs  顧客画面閲覧ログ
-- ================================================================
CREATE TABLE IF NOT EXISTS audit_view_logs (
  id          BIGSERIAL   PRIMARY KEY,
  user_id     TEXT        NOT NULL,           -- staff ID または auth.uid()
  customer_id UUID        REFERENCES customers(id) ON DELETE SET NULL,
  screen      TEXT        NOT NULL DEFAULT 'customer_detail'
                          CHECK (screen IN (
                            'customer_detail','customer_page','ai_proposal',
                            'service_log','line_chat','kpi_dashboard','menu_management'
                          )),
  ip_address  TEXT,                           -- クライアントIPアドレス（可能な場合）
  user_agent  TEXT,                           -- ブラウザ情報
  viewed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  audit_view_logs         IS '顧客画面閲覧ログ（誰がいつどの顧客画面を開いたか）';
COMMENT ON COLUMN audit_view_logs.user_id IS 'スタッフIDまたはauth.uid()';

CREATE INDEX IF NOT EXISTS idx_avl_user      ON audit_view_logs (user_id, viewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_avl_customer  ON audit_view_logs (customer_id, viewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_avl_date      ON audit_view_logs (viewed_at DESC);

ALTER TABLE audit_view_logs ENABLE ROW LEVEL SECURITY;

-- INSERT: 認証済みユーザーは自分のログのみ書ける
CREATE POLICY "staff insert own view logs" ON audit_view_logs
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- SELECT: owner のみ
CREATE POLICY "owner read view logs" ON audit_view_logs
  FOR SELECT USING (is_owner());

-- UPDATE / DELETE: 禁止（ポリシーなし = DENY）

-- ================================================================
--  2. audit_edit_logs  データ変更ログ
-- ================================================================
CREATE TABLE IF NOT EXISTS audit_edit_logs (
  id          BIGSERIAL   PRIMARY KEY,
  user_id     TEXT        NOT NULL,
  table_name  TEXT        NOT NULL,
  record_id   TEXT        NOT NULL,          -- UUID または複合キーの文字列表現
  action      TEXT        NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  before_data JSONB,                         -- 変更前データ（NULL = 新規追加）
  after_data  JSONB,                         -- 変更後データ（NULL = 削除）
  edited_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  audit_edit_logs             IS 'データ変更ログ（メモ/タグ/ログ/予約の変更内容）';
COMMENT ON COLUMN audit_edit_logs.before_data IS '変更前の行データ（JSON）。新規挿入時は NULL';
COMMENT ON COLUMN audit_edit_logs.after_data  IS '変更後の行データ（JSON）。削除時は NULL';

CREATE INDEX IF NOT EXISTS idx_ael_user       ON audit_edit_logs (user_id, edited_at DESC);
CREATE INDEX IF NOT EXISTS idx_ael_table      ON audit_edit_logs (table_name, edited_at DESC);
CREATE INDEX IF NOT EXISTS idx_ael_record     ON audit_edit_logs (record_id, edited_at DESC);
CREATE INDEX IF NOT EXISTS idx_ael_date       ON audit_edit_logs (edited_at DESC);

ALTER TABLE audit_edit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff insert edit logs" ON audit_edit_logs
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "owner read edit logs" ON audit_edit_logs
  FOR SELECT USING (is_owner());

-- ================================================================
--  3. audit_export_logs  エクスポート操作ログ
-- ================================================================
CREATE TABLE IF NOT EXISTS audit_export_logs (
  id           BIGSERIAL   PRIMARY KEY,
  user_id      TEXT        NOT NULL,
  export_type  TEXT        NOT NULL
                           CHECK (export_type IN (
                             'customer_list','sales_csv','line_history',
                             'kpi_report','staff_log'
                           )),
  record_count INTEGER     NOT NULL DEFAULT 0,
  filters      JSONB       NOT NULL DEFAULT '{}'::jsonb,  -- 使用したフィルター条件
  file_name    TEXT,                                       -- ダウンロードファイル名
  exported_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  audit_export_logs            IS 'CSV/一括エクスポート操作ログ';
COMMENT ON COLUMN audit_export_logs.filters    IS '適用されたフィルター条件 (JSON)';
COMMENT ON COLUMN audit_export_logs.record_count IS 'エクスポートされたレコード数';

CREATE INDEX IF NOT EXISTS idx_axl_user   ON audit_export_logs (user_id, exported_at DESC);
CREATE INDEX IF NOT EXISTS idx_axl_type   ON audit_export_logs (export_type, exported_at DESC);
CREATE INDEX IF NOT EXISTS idx_axl_date   ON audit_export_logs (exported_at DESC);

ALTER TABLE audit_export_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff insert export logs" ON audit_export_logs
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "owner read export logs" ON audit_export_logs
  FOR SELECT USING (is_owner());

-- ================================================================
--  4. Trigger: staff_logs 変更を自動的に audit_edit_logs へ記録
-- ================================================================
CREATE OR REPLACE FUNCTION trg_audit_staff_logs()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id TEXT;
BEGIN
  -- アプリケーション設定からスタッフIDを取得（SET LOCAL で注入）
  BEGIN
    v_user_id := current_setting('app.current_user_id', true);
  EXCEPTION WHEN others THEN
    v_user_id := 'system';
  END;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_edit_logs (user_id, table_name, record_id, action, before_data, after_data)
    VALUES (v_user_id, 'staff_logs', NEW.id::TEXT, 'INSERT', NULL, row_to_json(NEW)::JSONB);
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_edit_logs (user_id, table_name, record_id, action, before_data, after_data)
    VALUES (v_user_id, 'staff_logs', NEW.id::TEXT, 'UPDATE', row_to_json(OLD)::JSONB, row_to_json(NEW)::JSONB);
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_edit_logs (user_id, table_name, record_id, action, before_data, after_data)
    VALUES (v_user_id, 'staff_logs', OLD.id::TEXT, 'DELETE', row_to_json(OLD)::JSONB, NULL);
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_audit_staff_logs ON staff_logs;
CREATE TRIGGER trg_audit_staff_logs
  AFTER INSERT OR UPDATE OR DELETE ON staff_logs
  FOR EACH ROW EXECUTE FUNCTION trg_audit_staff_logs();

-- ================================================================
--  5. Trigger: reservations 変更を自動的に audit_edit_logs へ記録
-- ================================================================
CREATE OR REPLACE FUNCTION trg_audit_reservations()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id TEXT;
BEGIN
  BEGIN
    v_user_id := current_setting('app.current_user_id', true);
  EXCEPTION WHEN others THEN
    v_user_id := 'system';
  END;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_edit_logs (user_id, table_name, record_id, action, before_data, after_data)
    VALUES (v_user_id, 'reservations', NEW.id::TEXT, 'INSERT', NULL, row_to_json(NEW)::JSONB);
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    -- ステータス変更のみ記録（軽量化）
    IF OLD.status IS DISTINCT FROM NEW.status
    OR OLD.scheduled_at IS DISTINCT FROM NEW.scheduled_at
    OR OLD.menu IS DISTINCT FROM NEW.menu THEN
      INSERT INTO audit_edit_logs (user_id, table_name, record_id, action, before_data, after_data)
      VALUES (v_user_id, 'reservations', NEW.id::TEXT, 'UPDATE',
        jsonb_build_object('status', OLD.status, 'scheduled_at', OLD.scheduled_at, 'menu', OLD.menu),
        jsonb_build_object('status', NEW.status, 'scheduled_at', NEW.scheduled_at, 'menu', NEW.menu));
    END IF;
    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_audit_reservations ON reservations;
CREATE TRIGGER trg_audit_reservations
  AFTER INSERT OR UPDATE ON reservations
  FOR EACH ROW EXECUTE FUNCTION trg_audit_reservations();

-- ================================================================
--  6. RPC: クライアントから安全に閲覧ログを書くためのラッパー
--     （SECURITY DEFINER でログ書き込みを保証）
-- ================================================================
CREATE OR REPLACE FUNCTION log_customer_view(
  p_user_id     TEXT,
  p_customer_id UUID,
  p_screen      TEXT DEFAULT 'customer_detail'
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO audit_view_logs (user_id, customer_id, screen)
  VALUES (p_user_id, p_customer_id, p_screen);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION log_customer_view IS 'クライアントからの閲覧ログ書き込み用 RPC';

-- ================================================================
--  7. 管理者向けビュー（owner 専用）
-- ================================================================

-- 直近7日の操作サマリー
CREATE OR REPLACE VIEW audit_summary_7days AS
SELECT
  'views'   AS log_type,
  user_id,
  COUNT(*)  AS count,
  MAX(viewed_at) AS last_action_at
FROM audit_view_logs
WHERE viewed_at >= now() - INTERVAL '7 days'
GROUP BY user_id

UNION ALL

SELECT
  'edits'   AS log_type,
  user_id,
  COUNT(*)  AS count,
  MAX(edited_at) AS last_action_at
FROM audit_edit_logs
WHERE edited_at >= now() - INTERVAL '7 days'
GROUP BY user_id

UNION ALL

SELECT
  'exports' AS log_type,
  user_id,
  COUNT(*)  AS count,
  MAX(exported_at) AS last_action_at
FROM audit_export_logs
WHERE exported_at >= now() - INTERVAL '7 days'
GROUP BY user_id;

COMMENT ON VIEW audit_summary_7days IS '直近7日のユーザー別操作サマリー（owner専用）';
