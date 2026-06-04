-- ============================================================
--  Menu Tables  –  Salon Riora OS
-- ============================================================

-- ── メニューマスタ ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS salon_menus (
  id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text    NOT NULL,
  category        text    NOT NULL CHECK (category IN ('facial','option','subscription')),
  price           integer NOT NULL CHECK (price >= 0),
  duration        integer NOT NULL CHECK (duration > 0),  -- 分
  is_active       boolean NOT NULL DEFAULT true,
  description     text             DEFAULT '',
  is_subscribable boolean NOT NULL DEFAULT false,
  line_tags       text[]  NOT NULL DEFAULT '{}',
  display_order   integer          DEFAULT 0,
  created_at      timestamptz      DEFAULT now(),
  updated_at      timestamptz      DEFAULT now()
);

COMMENT ON TABLE salon_menus IS 'サロンのメニューマスタ (施術/オプション/サブスク)';

-- ── メニュー × オプション 紐付け ──────────────────────────────────
CREATE TABLE IF NOT EXISTS salon_menu_options (
  menu_id    uuid REFERENCES salon_menus(id) ON DELETE CASCADE,
  option_id  uuid REFERENCES salon_menus(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (menu_id, option_id),
  CHECK (menu_id <> option_id)
);

-- ── 顧客サブスクリプション ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS salon_subscriptions (
  id            uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   uuid  REFERENCES customers(id) ON DELETE CASCADE,
  menu_id       uuid  REFERENCES salon_menus(id),
  status        text  NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','cancelled','paused')),
  started_at    date  NOT NULL DEFAULT CURRENT_DATE,
  ended_at      date,
  monthly_price integer NOT NULL CHECK (monthly_price >= 0),
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_customer ON salon_subscriptions (customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status   ON salon_subscriptions (status, started_at DESC);

-- ── メニュー分析（期間集計） ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS salon_menu_analytics (
  id                   uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_id              uuid     NOT NULL REFERENCES salon_menus(id) ON DELETE CASCADE,
  period_start         date     NOT NULL,
  period_end           date     NOT NULL,
  treatment_count      integer  DEFAULT 0,
  repeat_rate          numeric(5,2) DEFAULT 0,
  profit_margin        numeric(5,2) DEFAULT 0,
  ai_recommend_rate    numeric(5,2) DEFAULT 0,
  next_visit_rate      numeric(5,2) DEFAULT 0,
  upsell_success_rate  numeric(5,2) DEFAULT 0,
  vip_conversion_rate  numeric(5,2) DEFAULT 0,
  created_at           timestamptz DEFAULT now(),
  UNIQUE (menu_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_menu_analytics_menu   ON salon_menu_analytics (menu_id, period_start DESC);

-- ── updated_at トリガー ────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_salon_menus_updated_at    ON salon_menus;
DROP TRIGGER IF EXISTS trg_subscriptions_updated_at  ON salon_subscriptions;

CREATE TRIGGER trg_salon_menus_updated_at
  BEFORE UPDATE ON salon_menus
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_subscriptions_updated_at
  BEFORE UPDATE ON salon_subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── シードデータ（メニュー） ─────────────────────────────────────
INSERT INTO salon_menus (name, category, price, duration, is_active, description, is_subscribable, line_tags, display_order) VALUES
  ('プレミアムエイジングケア', 'facial', 18000, 90, true,  '厳選成分による最高峰のエイジングケア。VIPお客様に特におすすめ。',   true,  ARRAY['#エイジング','#プレミアム'], 1),
  ('モイスチャーフェイシャル', 'facial', 12000, 60, true,  '保湿を重視した定番フェイシャル。乾燥肌・敏感肌のお客様向け。',     true,  ARRAY['#保湿','#スタンダード'],    2),
  ('ポアクリーニングコース',   'facial', 14000, 75, true,  '毛穴の汚れを徹底除去。透明感アップに定評あり。',                   false, ARRAY['#毛穴','#美白'],            3),
  ('リラクゼーションコース',   'facial', 10000, 60, true,  '全身のリラックスを重視。ストレス解消・睡眠改善に効果的。',         true,  ARRAY['#リラクゼーション'],        4),
  ('ベーシックフェイシャル',   'facial',  8000, 45, true,  '初めてのお客様、体験コース。ご来店しやすいエントリーメニュー。',   false, ARRAY['#体験','#初回'],            5),
  ('美白トリートメント',       'option',  3000, 20, true,  '美白成分を集中浸透させるオプション施術。',                         false, ARRAY['#美白オプション'],          1),
  ('コラーゲンパック',         'option',  2000, 15, true,  'コラーゲン配合パックで肌にハリと潤いを。',                         false, ARRAY['#パック'],                  2),
  ('ヘッドスパ',               'option',  2500, 20, true,  '頭皮をほぐすリフレッシュオプション。',                             false, ARRAY['#ヘッドスパ'],              3),
  ('ベーシックサブスク',       'subscription', 20000, 60, true, '月1回フェイシャル込み。継続的なスキンケアをサポート。', true, ARRAY['#サブスク','#定期'],        1),
  ('プレミアムサブスク',       'subscription', 35000, 90, true, '月2回施術 + オプション1回付き。最上級のケアプラン。',   true, ARRAY['#プレミアム','#VIP'],        2)
ON CONFLICT DO NOTHING;
