-- ================================================================
--  Phase 1 Core Tables  –  Salon Riora OS
--  UI指示書２.PNG「最初に作るべきテーブル」に準拠
--  実行: supabase db push  OR  psql -f this_file.sql
-- ================================================================

-- ── update_updated_at ヘルパー（未作成の場合のみ） ─────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ================================================================
--  1. customers  顧客マスタ
-- ================================================================
CREATE TABLE IF NOT EXISTS customers (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT        NOT NULL,
  kana                TEXT,
  phone               TEXT,
  email               TEXT,

  -- 接客分類
  customer_type       TEXT        DEFAULT '信頼構築型'
                                  CHECK (customer_type IN (
                                    'VIP型','慎重・不安型','感情重視型',
                                    '効果重視型','信頼構築型'
                                  )),
  vip_rank            SMALLINT    NOT NULL DEFAULT 0,  -- 0=一般 1=シルバー 2=ゴールド 3=VIP

  -- リスク・エンゲージメント
  churn_risk          SMALLINT    NOT NULL DEFAULT 0 CHECK (churn_risk BETWEEN 0 AND 100),
  line_response_rate  SMALLINT    NOT NULL DEFAULT 0 CHECK (line_response_rate BETWEEN 0 AND 100),

  -- 来店実績
  visit_count         INTEGER     NOT NULL DEFAULT 0,
  total_spent         INTEGER     NOT NULL DEFAULT 0,  -- 累計売上（円）
  avg_price           INTEGER     NOT NULL DEFAULT 0,  -- 平均単価（円）
  last_visit          DATE,
  next_visit_prediction TEXT,

  -- タグ
  tags                TEXT[]      NOT NULL DEFAULT '{}',

  -- メタ
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE  customers             IS '顧客マスタ';
COMMENT ON COLUMN customers.vip_rank    IS '0=一般 1=シルバー 2=ゴールド 3=VIP';
COMMENT ON COLUMN customers.churn_risk  IS '失客リスク 0-100%';

CREATE INDEX IF NOT EXISTS idx_customers_type      ON customers (customer_type);
CREATE INDEX IF NOT EXISTS idx_customers_churn     ON customers (churn_risk DESC);
CREATE INDEX IF NOT EXISTS idx_customers_last_visit ON customers (last_visit DESC);

DROP TRIGGER IF EXISTS trg_customers_updated_at ON customers;
CREATE TRIGGER trg_customers_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ================================================================
--  2. reservations  予約テーブル
-- ================================================================
CREATE TABLE IF NOT EXISTS reservations (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id          UUID        REFERENCES customers(id) ON DELETE SET NULL,
  customer_hash_id     TEXT,
  staff_id             TEXT        NOT NULL,
  menu                 TEXT        NOT NULL DEFAULT 'フェイシャルケア',
  scheduled_at         TIMESTAMPTZ NOT NULL,
  duration_minutes     INTEGER     NOT NULL DEFAULT 60,
  status               TEXT        NOT NULL DEFAULT 'confirmed'
                                   CHECK (status IN ('confirmed','in_progress','completed','cancelled','no_show')),

  -- 顧客スナップショット（顧客が削除されても履歴保持）
  customer_name        TEXT        NOT NULL DEFAULT '',
  is_vip               BOOLEAN     NOT NULL DEFAULT false,
  churn_risk           SMALLINT    NOT NULL DEFAULT 0,
  days_since_last_visit INTEGER    NOT NULL DEFAULT 0,
  customer_type        TEXT        NOT NULL DEFAULT '信頼構築型',

  note                 TEXT,
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE reservations IS '予約テーブル';

CREATE INDEX IF NOT EXISTS idx_reservations_scheduled ON reservations (scheduled_at);
CREATE INDEX IF NOT EXISTS idx_reservations_staff     ON reservations (staff_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_reservations_status    ON reservations (status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_reservations_customer  ON reservations (customer_id);

DROP TRIGGER IF EXISTS trg_reservations_updated_at ON reservations;
CREATE TRIGGER trg_reservations_updated_at
  BEFORE UPDATE ON reservations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ================================================================
--  3. ai_suggestions  AI提案テーブル
-- ================================================================
CREATE TABLE IF NOT EXISTS ai_suggestions (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id          UUID        REFERENCES customers(id) ON DELETE CASCADE,
  customer_hash_id     TEXT,

  -- AI提案コンテンツ
  today_goal           TEXT,         -- 今日の施術方針
  recommended_menu     TEXT,         -- おすすめメニュー
  recommended_option   TEXT,         -- おすすめオプション
  ng_words             TEXT[],       -- NGワード
  next_visit_timing    TEXT,         -- 次回予約タイミング
  advice_message       TEXT,         -- アドバイスメッセージ

  -- 戦略ロジック（JSON）
  strategy_logic       JSONB         DEFAULT '{}'::jsonb,
    -- {
    --   "nextVisitMessage": "...",
    --   "adviceMessage": "...",
    --   "adviceTag": "[RIORA]" | "[TSUN-KUMA]",
    --   "riskScore": 0-100,
    --   "vipCandidate": bool,
    --   "customerType": "..."
    -- }

  suggestion_type      TEXT          DEFAULT 'general',
  created_at           TIMESTAMPTZ   DEFAULT now()
);

COMMENT ON TABLE ai_suggestions IS 'AI接客提案テーブル';

CREATE INDEX IF NOT EXISTS idx_ai_suggestions_customer ON ai_suggestions (customer_id, created_at DESC);

-- ================================================================
--  4. staff_logs  スタッフ施術ログ
-- ================================================================
CREATE TABLE IF NOT EXISTS staff_logs (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id       UUID        REFERENCES reservations(id) ON DELETE SET NULL,
  customer_id          UUID        REFERENCES customers(id)    ON DELETE SET NULL,
  staff_id             TEXT        NOT NULL,

  -- 施術結果フラグ
  service_completed    BOOLEAN     NOT NULL DEFAULT false,
  ai_adopted           BOOLEAN     NOT NULL DEFAULT false,   -- AI提案を活用した
  next_reserved        BOOLEAN     NOT NULL DEFAULT false,   -- 次回予約が取れた
  option_sold          BOOLEAN     NOT NULL DEFAULT false,   -- オプション提案した
  retail_sold          BOOLEAN     NOT NULL DEFAULT false,   -- 物販が売れた
  churn_followed       BOOLEAN     NOT NULL DEFAULT false,   -- 離脱フォローをした

  -- 売上
  sales_amount         INTEGER     DEFAULT 0,

  note                 TEXT,
  created_at           TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE staff_logs IS 'スタッフ施術ログ（KPI集計用）';

CREATE INDEX IF NOT EXISTS idx_staff_logs_staff   ON staff_logs (staff_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_logs_date    ON staff_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_logs_customer ON staff_logs (customer_id);

-- ================================================================
--  5. line_logs  LINE履歴
-- ================================================================
CREATE TABLE IF NOT EXISTS line_logs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID        REFERENCES customers(id) ON DELETE CASCADE,
  staff_id    TEXT,
  direction   TEXT        NOT NULL CHECK (direction IN ('sent','received')),
  message     TEXT        NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'delivered'
                          CHECK (status IN ('delivered','read','failed')),
  sent_at     TIMESTAMPTZ DEFAULT now(),
  created_at  TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE line_logs IS 'LINE送受信履歴';

CREATE INDEX IF NOT EXISTS idx_line_logs_customer ON line_logs (customer_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_line_logs_date     ON line_logs (sent_at DESC);

-- ================================================================
--  Row Level Security
-- ================================================================
ALTER TABLE customers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_logs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_logs     ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  -- customers
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='customers' AND policyname='auth all customers') THEN
    CREATE POLICY "auth all customers"   ON customers     FOR ALL USING (auth.role()='authenticated');
  END IF;
  -- reservations
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='reservations' AND policyname='auth all reservations') THEN
    CREATE POLICY "auth all reservations" ON reservations  FOR ALL USING (auth.role()='authenticated');
  END IF;
  -- ai_suggestions
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ai_suggestions' AND policyname='auth all ai_suggestions') THEN
    CREATE POLICY "auth all ai_suggestions" ON ai_suggestions FOR ALL USING (auth.role()='authenticated');
  END IF;
  -- staff_logs
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='staff_logs' AND policyname='auth all staff_logs') THEN
    CREATE POLICY "auth all staff_logs"  ON staff_logs    FOR ALL USING (auth.role()='authenticated');
  END IF;
  -- line_logs
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='line_logs' AND policyname='auth all line_logs') THEN
    CREATE POLICY "auth all line_logs"   ON line_logs     FOR ALL USING (auth.role()='authenticated');
  END IF;
END $$;

-- ================================================================
--  デモ用シードデータ
-- ================================================================
INSERT INTO customers
  (name, kana, customer_type, vip_rank, churn_risk, visit_count, total_spent,
   avg_price, last_visit, line_response_rate, tags)
VALUES
  ('田中 裕樹', 'タナカ ユウキ', 'VIP型',          3,  8, 24, 580000, 24167, CURRENT_DATE - 7,  95, ARRAY['VIP','常連','高単価']),
  ('鈴木 花子', 'スズキ ハナコ', '感情重視型',      0, 15,  3,  24000,  8000, CURRENT_DATE - 45, 72, ARRAY['新規','要フォロー']),
  ('佐藤 明子', 'サトウ アキコ', '効果重視型',      2, 20,  9, 148000, 16444, CURRENT_DATE - 18, 85, ARRAY['常連','リピーター']),
  ('山田 美咲', 'ヤマダ ミサキ', '慎重・不安型',    0, 78,  5,  40000,  8000, CURRENT_DATE - 62, 40, ARRAY['要注意','失客リスク']),
  ('高橋 ゆり', 'タカハシ ユリ', 'VIP型',           3,  5, 18, 342000, 19000, CURRENT_DATE - 4,  98, ARRAY['VIP','常連','安定']),
  ('伊藤 さくら','イトウ サクラ','信頼構築型',      1, 12,  6,  72000, 12000, CURRENT_DATE - 28, 60, ARRAY['常連'])
ON CONFLICT DO NOTHING;

-- 本日の予約シード
WITH customer_ids AS (
  SELECT id, name, customer_type, vip_rank, churn_risk, visit_count, total_spent
  FROM customers
  ORDER BY name
  LIMIT 6
)
INSERT INTO reservations
  (customer_id, staff_id, menu, scheduled_at, customer_name, is_vip,
   churn_risk, days_since_last_visit, customer_type)
SELECT
  c.id,
  'kameyama',
  CASE c.customer_type
    WHEN 'VIP型'       THEN 'プレミアムエイジングケア'
    WHEN '感情重視型'   THEN 'リラクゼーションコース'
    WHEN '効果重視型'   THEN 'ポアクリーニング + 美白ケア'
    WHEN '慎重・不安型' THEN 'モイスチャーフェイシャル'
    ELSE 'ベーシックフェイシャル'
  END,
  (CURRENT_DATE + (INTERVAL '1 hour' * (9 + row_number() OVER (ORDER BY c.name) * 1 + row_number() OVER (ORDER BY c.name) / 2))),
  c.name,
  c.vip_rank >= 3,
  c.churn_risk,
  30,
  c.customer_type
FROM customer_ids c
ON CONFLICT DO NOTHING;
