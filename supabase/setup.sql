-- ============================================================
-- Salon Riora OS — Supabase SQL Setup
-- Supabase > SQL Editor に貼り付けて実行
-- ============================================================

-- ============================================================
-- 共通: updated_at 自動更新トリガー関数
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- customers テーブル
-- ============================================================
CREATE TABLE IF NOT EXISTS customers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id    TEXT UNIQUE,
  name            TEXT,
  email           TEXT,
  phone           TEXT,
  visit_count     INT DEFAULT 0,
  customer_type   TEXT CHECK (customer_type IN ('sincere', 'speed', 'luxury')),
  is_vip          BOOLEAN DEFAULT FALSE,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER customers_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- profiles テーブル（Auth ユーザー ↔ スタッフロール紐付け）
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  staff_id    TEXT,
  role        TEXT CHECK (role IN ('staff', 'manager', 'owner')) DEFAULT 'staff',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- reservations テーブル
-- ============================================================
CREATE TABLE IF NOT EXISTS reservations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   UUID REFERENCES customers(id) ON DELETE SET NULL,
  staff_id      TEXT NOT NULL,
  menu          TEXT NOT NULL,
  scheduled_at  TIMESTAMPTZ NOT NULL,
  status        TEXT CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed')) DEFAULT 'pending',
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER reservations_updated_at
  BEFORE UPDATE ON reservations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- staff_logs テーブル（操作履歴）
-- ============================================================
CREATE TABLE IF NOT EXISTS staff_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id      TEXT NOT NULL,
  action        TEXT NOT NULL,
  target_table  TEXT,
  target_id     UUID,
  details       JSONB,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- line_logs テーブル（LINE送受信ログ）
-- ============================================================
CREATE TABLE IF NOT EXISTS line_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     UUID REFERENCES customers(id) ON DELETE SET NULL,
  line_user_id    TEXT,
  message_type    TEXT CHECK (message_type IN ('text', 'image', 'sticker', 'template', 'flex')),
  content         JSONB,
  direction       TEXT CHECK (direction IN ('inbound', 'outbound')) NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- RLS: ai_suggestions
-- ============================================================
ALTER TABLE ai_suggestions ENABLE ROW LEVEL SECURITY;

-- staff は自分が登録したデータのみ操作可
CREATE POLICY "staff_own_suggestions" ON ai_suggestions
  FOR ALL
  USING (
    staff_id = (SELECT staff_id FROM profiles WHERE id = auth.uid())
  )
  WITH CHECK (
    staff_id = (SELECT staff_id FROM profiles WHERE id = auth.uid())
  );

-- manager / owner は全件閲覧可
CREATE POLICY "manager_owner_read_all_suggestions" ON ai_suggestions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('manager', 'owner')
    )
  );

-- ============================================================
-- RLS: reservations
-- ============================================================
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;

-- staff は自分の予約のみ操作可
CREATE POLICY "staff_own_reservations" ON reservations
  FOR ALL
  USING (
    staff_id = (SELECT staff_id FROM profiles WHERE id = auth.uid())
  )
  WITH CHECK (
    staff_id = (SELECT staff_id FROM profiles WHERE id = auth.uid())
  );

-- manager / owner は全件閲覧可
CREATE POLICY "manager_owner_read_all_reservations" ON reservations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('manager', 'owner')
    )
  );

-- ============================================================
-- RLS: staff_logs（manager / owner のみ閲覧）
-- ============================================================
ALTER TABLE staff_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "manager_owner_read_staff_logs" ON staff_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('manager', 'owner')
    )
  );

-- ============================================================
-- RLS: line_logs（manager / owner のみ閲覧）
-- ============================================================
ALTER TABLE line_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "manager_owner_read_line_logs" ON line_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('manager', 'owner')
    )
  );

-- ============================================================
-- RLS: customers（認証済みは閲覧可・書き込みは manager / owner のみ）
-- ============================================================
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read_customers" ON customers
  FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "manager_owner_write_customers" ON customers
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('manager', 'owner')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('manager', 'owner')
    )
  );

-- ============================================================
-- Future-ready schema separation for admin-only and AI-internal data
-- ============================================================
CREATE SCHEMA IF NOT EXISTS admin_only;
CREATE SCHEMA IF NOT EXISTS ai_internal;

-- AI タグ: Edge Functions / AI 内部処理用
CREATE TABLE IF NOT EXISTS ai_internal.ai_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::JSONB,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS ai_tags_updated_at ON ai_internal.ai_tags;
CREATE TRIGGER ai_tags_updated_at
  BEFORE UPDATE ON ai_internal.ai_tags
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE ai_internal.ai_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_select_ai_tags" ON ai_internal.ai_tags
  FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE OR REPLACE FUNCTION ai_internal.insert_ai_tag(
  tag_name TEXT,
  tag_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS SETOF ai_internal.ai_tags
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  INSERT INTO ai_internal.ai_tags (name, metadata, created_by)
  VALUES (tag_name, tag_metadata, auth.uid())
  RETURNING *;
END;
$$;

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA ai_internal TO authenticated;
GRANT SELECT ON TABLE ai_internal.ai_tags TO authenticated;
GRANT EXECUTE ON FUNCTION ai_internal.insert_ai_tag(TEXT, JSONB) TO authenticated;
