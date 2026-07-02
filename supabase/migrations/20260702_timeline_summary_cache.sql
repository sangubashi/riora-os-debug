-- TL-2: AI Timeline Summary キャッシュテーブル
-- LLM生成サマリーを customer_id+store_id で1件保持する。
-- data_hash が一致かつ 7日以内であればキャッシュを返す。
-- Customer Memory 本文は AI Timeline 専用利用 (FireScore/提案生成へは渡さない)。

CREATE TABLE IF NOT EXISTS timeline_summary_cache (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  UUID        NOT NULL,
  store_id     UUID        NOT NULL,
  summary      TEXT        NOT NULL,
  motivation   TEXT        NOT NULL CHECK (motivation IN ('high', 'medium', 'low')),
  focus        TEXT,
  avoid        TEXT,
  data_hash    TEXT        NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (customer_id, store_id)
);

CREATE INDEX IF NOT EXISTS idx_timeline_summary_cache_customer_store
  ON timeline_summary_cache (customer_id, store_id);

ALTER TABLE timeline_summary_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON timeline_summary_cache
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
