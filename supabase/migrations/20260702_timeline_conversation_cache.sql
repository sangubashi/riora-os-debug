-- TL-3: AI Timeline 今日の一言 キャッシュテーブル
-- Claude Haiku が生成した会話スターターを customer_id+store_id で保持する。
-- data_hash 一致 + 7日以内 → キャッシュ返却。
-- 販売・営業文は生成禁止 (SYSTEM_PROMPT で制約)。
-- Customer Memory 本文は AI Timeline 専用利用。

CREATE TABLE IF NOT EXISTS timeline_conversation_cache (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    UUID        NOT NULL,
  store_id       UUID        NOT NULL,
  starters       JSONB       NOT NULL DEFAULT '[]',
  data_hash      TEXT        NOT NULL,
  generated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (customer_id, store_id)
);

CREATE INDEX IF NOT EXISTS idx_timeline_conversation_cache_customer_store
  ON timeline_conversation_cache (customer_id, store_id);

ALTER TABLE timeline_conversation_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON timeline_conversation_cache
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
