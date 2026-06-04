-- ============================================================
--  LINE CRM Tables  –  Salon Riora OS
-- ============================================================

-- ── LINE チャットスレッド ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS line_threads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     uuid REFERENCES customers(id) ON DELETE CASCADE,
  customer_name   text NOT NULL DEFAULT '',
  customer_type   text,
  last_message    text,
  last_message_at timestamptz,
  unread_count    integer      NOT NULL DEFAULT 0,
  is_urgent       boolean      NOT NULL DEFAULT false,
  churn_risk      integer      NOT NULL DEFAULT 0 CHECK (churn_risk BETWEEN 0 AND 100),
  days_since_visit integer     NOT NULL DEFAULT 0,
  tags            text[]       NOT NULL DEFAULT '{}',
  created_at      timestamptz  DEFAULT now(),
  updated_at      timestamptz  DEFAULT now(),
  UNIQUE (customer_id)
);

COMMENT ON TABLE line_threads IS 'LINEチャット一覧（顧客ごと1スレッド）';

-- ── LINE 個別メッセージ ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS line_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id   uuid REFERENCES line_threads(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
  staff_id    text,
  direction   text NOT NULL CHECK (direction IN ('sent','received')),
  body        text NOT NULL,
  status      text NOT NULL DEFAULT 'delivered'
                   CHECK (status IN ('delivered','read','failed')),
  sent_at     timestamptz DEFAULT now(),
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_line_msg_thread   ON line_messages (thread_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_line_msg_customer ON line_messages (customer_id, sent_at DESC);

-- ── セグメント ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS line_segments (
  id              uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text  NOT NULL UNIQUE,
  description     text,
  filter_criteria jsonb DEFAULT '{}',
  member_count    integer DEFAULT 0,
  created_at      timestamptz DEFAULT now()
);

INSERT INTO line_segments (name, description, member_count) VALUES
  ('全顧客',           'すべての登録顧客',                 52),
  ('1ヶ月以上未来店',  '最終来店から30日以上経過した顧客', 18),
  ('VIP顧客',          'VIPランク3以上の顧客',              8),
  ('サブスク会員',     'サブスクリプション契約中の顧客',   14),
  ('新規顧客',         '来店回数3回以下の顧客',             12)
ON CONFLICT (name) DO NOTHING;

-- ── 一括配信 ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS line_broadcasts (
  id            uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text,
  body          text  NOT NULL,
  segment_names text[] NOT NULL DEFAULT '{}',
  status        text  NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','scheduled','sent','failed')),
  scheduled_at  timestamptz,
  sent_at       timestamptz,
  sent_count    integer DEFAULT 0,
  created_by    text,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_broadcasts_status ON line_broadcasts (status, created_at DESC);

-- ── メッセージテンプレート ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS line_templates (
  id         uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  title      text  NOT NULL,
  body       text  NOT NULL,
  tags       text[] NOT NULL DEFAULT '{}',
  used_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

INSERT INTO line_templates (title, body, tags) VALUES
  ('施術後フォロー',
   '〇〇様、先日はご来店ありがとうございました🌸 お肌の調子はいかがでしょうか？何かご不明な点がございましたらお気軽にご連絡ください。',
   ARRAY['フォロー']),
  ('前回施術から3週間',
   '〇〇様、こんにちは😊 前回のご来店から3週間が経ちました。お肌の状態はいかがでしょうか？ぜひまたご来店をお待ちしております。',
   ARRAY['フォロー','来店促進']),
  ('今週空きございます',
   '〇〇様、こんにちは🌸 今週まだお席に余裕がございます。ご都合がよろしければぜひご利用ください✨',
   ARRAY['空き案内']),
  ('キャンセルフォロー',
   '〇〇様、先日はご連絡をいただきありがとうございました。またご都合のよい日程があればぜひご連絡ください🌸',
   ARRAY['キャンセル']),
  ('VIP 特別ご案内',
   '〇〇様、いつもご来店ありがとうございます✨ 特別な新メニューをいち早くご案内させていただきます。',
   ARRAY['VIP']),
  ('お誕生日メッセージ',
   '〇〇様、お誕生日おめでとうございます🎂 いつもご来店いただきありがとうございます。素敵な一年になりますように🌸',
   ARRAY['誕生日'])
ON CONFLICT DO NOTHING;

-- ── updated_at トリガー ────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_line_threads_updated_at   ON line_threads;
DROP TRIGGER IF EXISTS trg_line_templates_updated_at ON line_templates;

CREATE TRIGGER trg_line_threads_updated_at
  BEFORE UPDATE ON line_threads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_line_templates_updated_at
  BEFORE UPDATE ON line_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
