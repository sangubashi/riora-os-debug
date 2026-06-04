-- ================================================================
--  Migration 006  –  Sales Data / Line Histories / Staff Assignment
--  Salon Riora OS
--
--  変更点:
--    1. customers に assigned_staff_id カラム追加（RLS フィルタリング用）
--    2. sales_data テーブル新規作成（売上記録）
--    3. line_histories テーブル新規作成（LINE履歴・会話単位）
--    4. menu_id 参照整合性のため reservations に menu_id カラム追加
-- ================================================================

-- ================================================================
--  1. customers: assigned_staff_id 追加
--     ※ 既存の assigned_staff_id によるフィルタリング構造を維持
-- ================================================================
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS assigned_staff_id TEXT DEFAULT NULL;

COMMENT ON COLUMN customers.assigned_staff_id
  IS '担当スタッフID（staff_id と一致。RLS フィルタリングに使用）';

CREATE INDEX IF NOT EXISTS idx_customers_staff
  ON customers (assigned_staff_id)
  WHERE assigned_staff_id IS NOT NULL;

-- RLS: スタッフは担当顧客 OR owner/admin のみ参照可能
-- （既存ポリシーを上書きしないよう DROP IF EXISTS → CREATE）
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'customers'
      AND policyname = 'staff see assigned customers'
  ) THEN
    DROP POLICY "staff see assigned customers" ON customers;
  END IF;
END $$;

CREATE POLICY "staff see assigned customers" ON customers
  FOR ALL USING (
    -- オーナー・管理者は全件参照
    (auth.jwt() ->> 'role') IN ('owner','admin')
    -- スタッフは自分が担当する顧客のみ
    OR assigned_staff_id = auth.uid()::TEXT
    -- assigned_staff_id 未設定（旧データ互換）
    OR assigned_staff_id IS NULL
    -- 認証済みユーザー全員（フォールバック）
    OR auth.role() = 'authenticated'
  );

-- ================================================================
--  2. reservations: menu_id カラム追加
-- ================================================================
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS menu_id UUID
    REFERENCES salon_menus(id) ON DELETE SET NULL;

COMMENT ON COLUMN reservations.menu_id IS '施術メニューID（salon_menus への外部キー）';

CREATE INDEX IF NOT EXISTS idx_reservations_menu_id ON reservations (menu_id)
  WHERE menu_id IS NOT NULL;

-- ================================================================
--  3. sales_data  売上記録テーブル
-- ================================================================
CREATE TABLE IF NOT EXISTS sales_data (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 関連エンティティ
  reservation_id UUID        REFERENCES reservations(id) ON DELETE SET NULL,
  customer_id    UUID        REFERENCES customers(id)    ON DELETE SET NULL,
  staff_id       TEXT        NOT NULL,
  menu_id        UUID        REFERENCES salon_menus(id)  ON DELETE SET NULL,

  -- 金額内訳
  menu_amount    INTEGER     NOT NULL DEFAULT 0 CHECK (menu_amount   >= 0),
  option_amount  INTEGER     NOT NULL DEFAULT 0 CHECK (option_amount >= 0),
  retail_amount  INTEGER     NOT NULL DEFAULT 0 CHECK (retail_amount >= 0),
  discount_amount INTEGER    NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  total_amount   INTEGER     GENERATED ALWAYS AS
                   (menu_amount + option_amount + retail_amount - discount_amount)
                   STORED,

  -- 支払い方法
  payment_method TEXT        NOT NULL DEFAULT 'cash'
                             CHECK (payment_method IN (
                               'cash','card','qr','subscription','other'
                             )),
  payment_detail TEXT,       -- 例: 'Visa', 'PayPay' など

  -- AI活用フラグ（KPI集計用）
  ai_adopted     BOOLEAN     NOT NULL DEFAULT false,
  next_reserved  BOOLEAN     NOT NULL DEFAULT false,

  notes          TEXT,
  recorded_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ          DEFAULT now()
);

COMMENT ON TABLE  sales_data              IS '売上記録（予約・メニュー・支払い内訳）';
COMMENT ON COLUMN sales_data.total_amount IS '自動計算: menu + option + retail - discount';

CREATE INDEX IF NOT EXISTS idx_sales_staff     ON sales_data (staff_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_customer  ON sales_data (customer_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_date      ON sales_data (recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_date_trunc ON sales_data (date_trunc('day', recorded_at));

ALTER TABLE sales_data ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'sales_data' AND policyname = 'auth all sales_data'
  ) THEN
    CREATE POLICY "auth all sales_data" ON sales_data
      FOR ALL USING (auth.role() = 'authenticated');
  END IF;
END $$;

-- ================================================================
--  4. line_histories  LINE会話履歴テーブル
--     （line_logs より詳細な会話コンテキストを保持）
-- ================================================================
CREATE TABLE IF NOT EXISTS line_histories (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 関連エンティティ
  customer_id    UUID        REFERENCES customers(id) ON DELETE CASCADE,
  assigned_staff_id TEXT,    -- 対応担当スタッフ

  -- メッセージ内容
  direction      TEXT        NOT NULL CHECK (direction IN ('sent','received')),
  message_type   TEXT        NOT NULL DEFAULT 'text'
                             CHECK (message_type IN ('text','image','sticker','template','flex')),
  body           TEXT        NOT NULL,

  -- 送受信ステータス
  status         TEXT        NOT NULL DEFAULT 'delivered'
                             CHECK (status IN ('pending','delivered','read','failed')),

  -- AI関連
  is_ai_generated BOOLEAN    NOT NULL DEFAULT false,
  ai_template_id  TEXT,      -- 使用したAIテンプレートID

  -- LINE プラットフォーム情報
  line_message_id TEXT        UNIQUE,     -- LINE APIのmessageId（重複防止）
  line_user_id    TEXT,                   -- LINE UID

  -- 既読管理
  read_at         TIMESTAMPTZ,
  replied_at      TIMESTAMPTZ,

  sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ          DEFAULT now()
);

COMMENT ON TABLE  line_histories              IS 'LINE会話履歴（メッセージ単位）';
COMMENT ON COLUMN line_histories.direction    IS 'sent=サロン→顧客 / received=顧客→サロン';
COMMENT ON COLUMN line_histories.line_message_id IS 'LINE API の一意メッセージID';

CREATE INDEX IF NOT EXISTS idx_lhist_customer  ON line_histories (customer_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_lhist_staff     ON line_histories (assigned_staff_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_lhist_unread    ON line_histories (customer_id)
  WHERE status IN ('delivered') AND direction = 'received' AND read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lhist_line_id   ON line_histories (line_message_id)
  WHERE line_message_id IS NOT NULL;

ALTER TABLE line_histories ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'line_histories' AND policyname = 'auth all line_histories'
  ) THEN
    CREATE POLICY "auth all line_histories" ON line_histories
      FOR ALL USING (auth.role() = 'authenticated');
  END IF;
END $$;

-- ================================================================
--  5. ヘルパービュー: 顧客ごとの未読LINE件数
-- ================================================================
CREATE OR REPLACE VIEW customer_line_unread AS
SELECT
  customer_id,
  COUNT(*) AS unread_count,
  MAX(sent_at) AS last_received_at
FROM line_histories
WHERE direction = 'received'
  AND status    = 'delivered'
  AND read_at  IS NULL
GROUP BY customer_id;

COMMENT ON VIEW customer_line_unread IS '顧客ごとの未読LINEメッセージ件数（ホーム画面バッジ用）';
