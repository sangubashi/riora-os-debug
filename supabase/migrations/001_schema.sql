-- ============================================================
-- Riora OS - Full PostgreSQL Schema with RLS
-- Supabase SQL Editor にそのままペーストして実行してください
--
-- 修正: profiles を is_owner() より先に作成し、
--       参照順序のエラーを解消
-- ============================================================

-- ----------------------------------------------------------------
-- Step 1: profiles テーブル（依存なし・auth.users のみ参照）
-- ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS profiles (
  id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('owner', 'staff')) DEFAULT 'staff',
  staff_name   TEXT NOT NULL DEFAULT '',
  display_name TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------
-- Step 2: is_owner() ヘルパー関数
-- profiles が存在した後に作成する必要がある
-- SECURITY DEFINER でポリシー内の無限再帰を防止
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION is_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND role = 'owner'
  );
$$;

-- ----------------------------------------------------------------
-- Step 3: profiles の RLS
-- ----------------------------------------------------------------

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_own" ON profiles
  FOR SELECT USING (auth.uid() = id OR is_owner());

CREATE POLICY "profiles_insert_own" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE USING (auth.uid() = id OR is_owner());

GRANT SELECT, INSERT, UPDATE ON profiles TO authenticated;

-- ----------------------------------------------------------------
-- Step 4: customers
-- owner: 全件 / staff: assigned_staff_id が自分のみ
-- ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS customers (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  name_kana          TEXT,
  phone              TEXT,
  email              TEXT,
  customer_type      TEXT NOT NULL DEFAULT '信頼構築型',
  is_vip             BOOLEAN NOT NULL DEFAULT false,
  visit_count        INT NOT NULL DEFAULT 0,
  total_spent        INT NOT NULL DEFAULT 0,
  last_visit_date    DATE,
  next_visit_date    DATE,
  churn_risk_score   INT NOT NULL DEFAULT 0,
  assigned_staff_id  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  memo               TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customers_owner_all" ON customers
  FOR ALL USING (is_owner());

CREATE POLICY "customers_staff_select" ON customers
  FOR SELECT USING (
    NOT is_owner()
    AND assigned_staff_id = auth.uid()
  );

CREATE POLICY "customers_staff_insert" ON customers
  FOR INSERT WITH CHECK (
    NOT is_owner()
    AND assigned_staff_id = auth.uid()
  );

CREATE POLICY "customers_staff_update" ON customers
  FOR UPDATE USING (
    NOT is_owner()
    AND assigned_staff_id = auth.uid()
  );

GRANT SELECT, INSERT, UPDATE ON customers TO authenticated;

-- updated_at 自動更新トリガー
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER customers_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ----------------------------------------------------------------
-- Step 5: reservations
-- owner: 全件 / staff: staff_id が自分のみ
-- ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS reservations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id      UUID REFERENCES customers(id) ON DELETE SET NULL,
  staff_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  menu             TEXT NOT NULL,
  price            INT NOT NULL DEFAULT 0,
  scheduled_at     TIMESTAMPTZ NOT NULL,
  duration_minutes INT NOT NULL DEFAULT 60,
  status           TEXT NOT NULL DEFAULT 'confirmed'
                   CHECK (status IN ('confirmed', 'in_progress', 'completed', 'cancelled')),
  is_new_customer  BOOLEAN NOT NULL DEFAULT false,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reservations_owner_all" ON reservations
  FOR ALL USING (is_owner());

CREATE POLICY "reservations_staff_select" ON reservations
  FOR SELECT USING (
    NOT is_owner()
    AND staff_id = auth.uid()
  );

CREATE POLICY "reservations_staff_insert" ON reservations
  FOR INSERT WITH CHECK (
    NOT is_owner()
    AND staff_id = auth.uid()
  );

CREATE POLICY "reservations_staff_update" ON reservations
  FOR UPDATE USING (
    NOT is_owner()
    AND staff_id = auth.uid()
  );

GRANT SELECT, INSERT, UPDATE ON reservations TO authenticated;

-- ----------------------------------------------------------------
-- Step 6: staff_logs（接客記録）
-- ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS staff_logs (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id               UUID REFERENCES customers(id) ON DELETE SET NULL,
  staff_id                  UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  reservation_id            UUID REFERENCES reservations(id) ON DELETE SET NULL,
  log_text                  TEXT,
  services_done             JSONB NOT NULL DEFAULT '[]',
  next_visit_recommended_at DATE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE staff_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_logs_own_select" ON staff_logs
  FOR SELECT USING (staff_id = auth.uid() OR is_owner());

CREATE POLICY "staff_logs_own_insert" ON staff_logs
  FOR INSERT WITH CHECK (staff_id = auth.uid() OR is_owner());

CREATE POLICY "staff_logs_own_update" ON staff_logs
  FOR UPDATE USING (staff_id = auth.uid() OR is_owner());

GRANT SELECT, INSERT, UPDATE ON staff_logs TO authenticated;

-- ----------------------------------------------------------------
-- Step 7: ai_tags（顧客ごとのAIタグ）
-- ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ai_tags (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  UUID UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
  tags         TEXT[] NOT NULL DEFAULT '{}',
  dry_skin     BOOLEAN NOT NULL DEFAULT false,
  uv_sensitive BOOLEAN NOT NULL DEFAULT false,
  sales_hate   BOOLEAN NOT NULL DEFAULT false,
  vip          BOOLEAN NOT NULL DEFAULT false,
  repeat_high  BOOLEAN NOT NULL DEFAULT false,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ai_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_tags_authenticated_all" ON ai_tags
  FOR ALL USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

GRANT SELECT, INSERT, UPDATE, DELETE ON ai_tags TO authenticated;

-- ----------------------------------------------------------------
-- Step 8: line_logs（LINE送受信履歴）
-- ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS line_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  staff_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  direction   TEXT NOT NULL CHECK (direction IN ('sent', 'received')),
  message     TEXT NOT NULL,
  template_id UUID,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE line_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "line_logs_own_select" ON line_logs
  FOR SELECT USING (staff_id = auth.uid() OR is_owner());

CREATE POLICY "line_logs_own_insert" ON line_logs
  FOR INSERT WITH CHECK (staff_id = auth.uid() OR is_owner());

GRANT SELECT, INSERT ON line_logs TO authenticated;

-- ----------------------------------------------------------------
-- Step 9: template_categories（依存なし）
-- ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS template_categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0
);

ALTER TABLE template_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "template_categories_read" ON template_categories
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "template_categories_owner_write" ON template_categories
  FOR INSERT WITH CHECK (is_owner());

CREATE POLICY "template_categories_owner_update" ON template_categories
  FOR UPDATE USING (is_owner());

CREATE POLICY "template_categories_owner_delete" ON template_categories
  FOR DELETE USING (is_owner());

GRANT SELECT, INSERT, UPDATE, DELETE ON template_categories TO authenticated;

-- ----------------------------------------------------------------
-- Step 10: line_templates（template_categories に依存）
-- ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS line_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID REFERENCES template_categories(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  tags        TEXT[] NOT NULL DEFAULT '{}',
  use_count   INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE line_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "line_templates_read" ON line_templates
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "line_templates_owner_write" ON line_templates
  FOR INSERT WITH CHECK (is_owner());

CREATE POLICY "line_templates_owner_update" ON line_templates
  FOR UPDATE USING (is_owner());

CREATE POLICY "line_templates_owner_delete" ON line_templates
  FOR DELETE USING (is_owner());

-- use_count インクリメント（全スタッフ可）
CREATE POLICY "line_templates_staff_use_count" ON line_templates
  FOR UPDATE USING (auth.uid() IS NOT NULL);

GRANT SELECT, INSERT, UPDATE, DELETE ON line_templates TO authenticated;

-- ----------------------------------------------------------------
-- Step 11: 監査ログ 3テーブル（profiles・customers に依存）
-- ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_view_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  viewer_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  viewed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE audit_view_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_view_logs_owner_select" ON audit_view_logs
  FOR SELECT USING (is_owner());

CREATE POLICY "audit_view_logs_insert" ON audit_view_logs
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

GRANT SELECT, INSERT ON audit_view_logs TO authenticated;


CREATE TABLE IF NOT EXISTS audit_edit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  editor_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  diff        JSONB,
  edited_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE audit_edit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_edit_logs_owner_select" ON audit_edit_logs
  FOR SELECT USING (is_owner());

CREATE POLICY "audit_edit_logs_insert" ON audit_edit_logs
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

GRANT SELECT, INSERT ON audit_edit_logs TO authenticated;


CREATE TABLE IF NOT EXISTS audit_csv_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exporter_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  record_count INT,
  filters      JSONB,
  exported_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE audit_csv_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_csv_logs_owner_select" ON audit_csv_logs
  FOR SELECT USING (is_owner());

CREATE POLICY "audit_csv_logs_insert" ON audit_csv_logs
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

GRANT SELECT, INSERT ON audit_csv_logs TO authenticated;

-- ----------------------------------------------------------------
-- Step 12: kpi_today ビュー（reservations に依存）
-- security_invoker = true でRLSが透過適用（Postgres 15以上）
-- ----------------------------------------------------------------

CREATE OR REPLACE VIEW kpi_today AS
SELECT
  COALESCE(SUM(
    CASE WHEN status = 'completed'
         AND DATE(scheduled_at) = CURRENT_DATE
    THEN price ELSE 0 END
  ), 0) AS today_sales,

  COALESCE(SUM(
    CASE WHEN status = 'completed'
         AND DATE(scheduled_at) = CURRENT_DATE - INTERVAL '1 day'
    THEN price ELSE 0 END
  ), 0) AS yesterday_sales,

  COUNT(*) FILTER (
    WHERE DATE(scheduled_at) = CURRENT_DATE
  ) AS today_reservations,

  COUNT(*) FILTER (
    WHERE DATE(scheduled_at) = CURRENT_DATE
      AND status IN ('confirmed', 'in_progress', 'completed')
  ) AS today_booked,

  COUNT(*) FILTER (
    WHERE DATE(scheduled_at) = CURRENT_DATE
      AND status = 'completed'
  ) AS today_completed

FROM reservations;

ALTER VIEW kpi_today SET (security_invoker = true);

GRANT SELECT ON kpi_today TO authenticated;

-- ----------------------------------------------------------------
-- Step 13: シードデータ - template_categories（5カテゴリ）
-- ----------------------------------------------------------------

INSERT INTO template_categories (id, name, sort_order) VALUES
  ('00000000-0000-0000-0000-000000000001', 'ご来店後のお礼',         0),
  ('00000000-0000-0000-0000-000000000002', 'ご予約リマインド',       1),
  ('00000000-0000-0000-0000-000000000003', '次回ご来店のご案内',     2),
  ('00000000-0000-0000-0000-000000000004', 'スペシャルキャンペーン', 3),
  ('00000000-0000-0000-0000-000000000005', '失客防止メッセージ',     4)
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------
-- Step 14: シードデータ - line_templates（15件）
-- ----------------------------------------------------------------

INSERT INTO line_templates (category_id, title, body, tags) VALUES

-- ① ご来店後のお礼
('00000000-0000-0000-0000-000000000001',
 'ご来店ありがとうございました',
 'こんにちは、リオラです。
本日はご来店いただきありがとうございました。
施術の仕上がりはいかがでしたか？
またいつでもお気軽にご来店ください。',
 ARRAY['来店後', 'お礼']),

('00000000-0000-0000-0000-000000000001',
 '初回ご来店のお礼',
 'こんにちは。本日はリオラへの初めてのご来店、誠にありがとうございました。
緊張されていたかと思いますが、少しでもリラックスしていただけましたか？
またのご来店をスタッフ一同お待ちしております。',
 ARRAY['初回', '来店後', 'お礼']),

('00000000-0000-0000-0000-000000000001',
 '施術後ケアのご案内',
 'こんにちは。本日は施術をお受けいただきありがとうございました。
施術後24時間は洗顔を優しめにしていただき、保湿をしっかり行っていただくとより効果が持続します。
何かご不明な点がありましたらいつでもご連絡ください。',
 ARRAY['来店後', 'アフターケア']),

-- ② ご予約リマインド
('00000000-0000-0000-0000-000000000002',
 '明日のご予約リマインド',
 'こんにちは、リオラです。
明日のご予約のご確認です。
ご来店をスタッフ一同楽しみにお待ちしております。
ご変更・キャンセルの場合はお早めにご連絡ください。',
 ARRAY['リマインド', '前日']),

('00000000-0000-0000-0000-000000000002',
 '3日前のご予約リマインド',
 'こんにちは。ご予約日まで3日となりました。
何かご不明な点やご要望がございましたら、お気軽にお知らせください。
ご来店をお待ちしております。',
 ARRAY['リマインド', '3日前']),

('00000000-0000-0000-0000-000000000002',
 '当日のご予約確認',
 'こんにちは、リオラです。
本日のご予約のお時間が近づいてまいりました。
スタッフ一同お待ちしております。',
 ARRAY['リマインド', '当日']),

-- ③ 次回ご来店のご案内
('00000000-0000-0000-0000-000000000003',
 '次回ご来店のご提案',
 'こんにちは。先日はご来店ありがとうございました。
お肌の調子はいかがですか？
前回の施術から1ヶ月が経ちますので、次のケアのご提案がございます。
ご都合の良いお日にちをお聞かせいただけますか？',
 ARRAY['次回案内', 'リピート']),

('00000000-0000-0000-0000-000000000003',
 '定期コースのご案内',
 'こんにちは。
リオラでは毎月のケアを継続いただくことで、より高い効果が期待できます。
定期コースをご利用いただくと、お得な料金でご案内できます。
ご興味がございましたらお気軽にご相談ください。',
 ARRAY['定期コース', '次回案内']),

('00000000-0000-0000-0000-000000000003',
 '季節の変わり目ケアのご案内',
 'こんにちは。季節の変わり目はお肌が敏感になりやすい時期です。
この時期に合わせた特別なケアのご提案がございます。
ご希望の方はぜひご予約ください。',
 ARRAY['季節', '次回案内']),

-- ④ スペシャルキャンペーン
('00000000-0000-0000-0000-000000000004',
 'お誕生日特別クーポン',
 'お誕生日おめでとうございます。
日頃のご愛顧に感謝して、特別クーポンをプレゼントいたします。
今月中にご来店の際にご提示ください（10%オフ）。
素敵な一年になりますように。',
 ARRAY['誕生日', 'クーポン', 'VIP']),

('00000000-0000-0000-0000-000000000004',
 '限定キャンペーンのお知らせ',
 'こんにちは。
今月限定の特別キャンペーンをご案内いたします。
新メニュー「プレミアムエイジングケア」を特別価格でお試しいただけます。
ご予約はお早めに。先着限定です。',
 ARRAY['キャンペーン', '限定', '新メニュー']),

('00000000-0000-0000-0000-000000000004',
 'お友だちご紹介キャンペーン',
 'こんにちは。
リオラではお友だちご紹介キャンペーンを実施中です。
ご紹介いただいたお客様には次回使えるポイントをプレゼントいたします。
お気軽にお声がけください。',
 ARRAY['紹介', 'キャンペーン']),

-- ⑤ 失客防止メッセージ
('00000000-0000-0000-0000-000000000005',
 'お久しぶりのご連絡',
 'こんにちは、リオラです。
お元気ですか？最近お見かけしていなかったのでご連絡いたしました。
もしよろしければ、またぜひお顔を見せてください。
スタッフ一同お待ちしております。',
 ARRAY['失客防止', '休眠顧客']),

('00000000-0000-0000-0000-000000000005',
 '復活クーポンのご案内',
 'こんにちは。
しばらくご来店がなかったため、特別なご案内です。
久しぶりのご来店に「お帰りなさいクーポン」をご用意しました（20%オフ）。
また元気なお顔を見せてください。スタッフ一同お待ちしております。',
 ARRAY['失客防止', 'クーポン', '復活']),

('00000000-0000-0000-0000-000000000005',
 'ケア状態フォローアップ',
 'こんにちは。
以前ご来店いただいた際にお肌のお悩みを伺っていましたが、その後いかがですか？
何かお困りのことがあればお気軽にご相談ください。
またのご来店をお待ちしております。',
 ARRAY['失客防止', 'フォローアップ'])

ON CONFLICT DO NOTHING;
