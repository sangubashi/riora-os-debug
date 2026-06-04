-- ============================================================
-- Salon Riora OS — PII 分離テーブル + RLS
-- Supabase > SQL Editor に貼り付けて実行
-- ============================================================

-- ============================================================
-- customers_pii テーブル（個人情報：最小限の照合用のみ）
-- AI・外部サービスには絶対に渡さない
-- ============================================================
CREATE TABLE IF NOT EXISTS customers_pii (
  hash_id         TEXT PRIMARY KEY,         -- sha256(normalized_phone + HASH_SECRET)
  last_name_kana  TEXT,                     -- 照合用（姓カナのみ）
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER customers_pii_updated_at
  BEFORE UPDATE ON customers_pii
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS: manager / owner のみ閲覧・操作可（staff は PII にアクセス不可）
ALTER TABLE customers_pii ENABLE ROW LEVEL SECURITY;

CREATE POLICY "manager_owner_only_pii" ON customers_pii
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
-- customers_secure テーブル（AI に渡す非 PII データ）
-- 電話番号・氏名は保存しない
-- ============================================================
CREATE TABLE IF NOT EXISTS customers_secure (
  hash_id         TEXT PRIMARY KEY REFERENCES customers_pii(hash_id) ON DELETE CASCADE,
  birthday        DATE,
  skin_type       TEXT CHECK (skin_type IN ('dry', 'oily', 'combination', 'sensitive', 'normal')),
  risk_score      NUMERIC(4,2) DEFAULT 0 CHECK (risk_score >= 0 AND risk_score <= 10),
  ltv             NUMERIC(12,2) DEFAULT 0,
  visit_count     INT DEFAULT 1,
  customer_type   TEXT CHECK (customer_type IN ('sincere', 'speed', 'luxury')),
  is_vip          BOOLEAN DEFAULT FALSE,
  last_visit_at   TIMESTAMPTZ,
  notes           TEXT,                     -- AI 向けメモ（PII 含まないこと）
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER customers_secure_updated_at
  BEFORE UPDATE ON customers_secure
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS: 認証済みスタッフは閲覧可・書き込みは manager / owner のみ
ALTER TABLE customers_secure ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read_secure" ON customers_secure
  FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "manager_owner_write_secure" ON customers_secure
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
-- ai_suggestions に customer_hash_id カラムを追加
-- （既存 customer_id UUID FK とは別に hash_id でも紐付け可能に）
-- ============================================================
ALTER TABLE ai_suggestions
  ADD COLUMN IF NOT EXISTS customer_hash_id TEXT REFERENCES customers_pii(hash_id) ON DELETE SET NULL;

-- ============================================================
-- line_logs に customer_hash_id カラムを追加
-- （LINE user_id → hash_id で Square / SalonBoard と統合）
-- ============================================================
ALTER TABLE line_logs
  ADD COLUMN IF NOT EXISTS customer_hash_id TEXT REFERENCES customers_pii(hash_id) ON DELETE SET NULL;

-- ============================================================
-- reservations に customer_hash_id カラムを追加
-- ============================================================
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS customer_hash_id TEXT REFERENCES customers_pii(hash_id) ON DELETE SET NULL;

-- ============================================================
-- 統合インデックス（hash_id での横断検索を高速化）
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_ai_suggestions_hash  ON ai_suggestions(customer_hash_id);
CREATE INDEX IF NOT EXISTS idx_line_logs_hash        ON line_logs(customer_hash_id);
CREATE INDEX IF NOT EXISTS idx_reservations_hash     ON reservations(customer_hash_id);
