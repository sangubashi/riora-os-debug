-- =========================================================
-- LINE AI 半自動配信システム: テーブル定義
-- =========================================================

-- LINE連携ユーザー管理
CREATE TABLE IF NOT EXISTS line_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   uuid,
  line_user_id  text UNIQUE NOT NULL,
  display_name  text,
  blocked       boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- AI生成LINEキャンペーン
-- status: draft → approved → sent | rejected
CREATE TABLE IF NOT EXISTS line_campaigns (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  theme        text NOT NULL,
  message_text text NOT NULL,
  target_tags  text[] NOT NULL DEFAULT '{}',
  status       text NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft', 'approved', 'sent', 'rejected')),
  approved_by  text,
  approved_at  timestamptz,
  sent_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- 配信ログ
CREATE TABLE IF NOT EXISTS line_logs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id    uuid REFERENCES line_campaigns(id) ON DELETE CASCADE,
  line_user_id   text NOT NULL,
  status         text NOT NULL CHECK (status IN ('sent', 'failed', 'blocked')),
  sent_at        timestamptz NOT NULL DEFAULT now()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_line_campaigns_status ON line_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_line_campaigns_created_at ON line_campaigns(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_line_logs_campaign_id ON line_logs(campaign_id);
