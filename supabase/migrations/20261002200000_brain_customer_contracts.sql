-- ================================================================
-- /karte 契約書・申込書(サブスクリプション申込書・回数券購入申込書): テーブル + 専用Storageバケット
-- (2026-10-02)
--
-- 方針:
--   * 保存済みの契約書は変更・削除しない(追記のみ)。service_roleにもSELECT/INSERTしか付与しない。
--     brain_customersの物理削除で契約書が消えないよう FK は ON DELETE RESTRICT。
--   * RLSは brain_customer_photos / brain_customer_documents と同じ「service_role限定」。
--     authenticated/anon には一切許可しない(アクセス制御はAPI層の canAccessCustomer)。
--   * line_items には保存時点のコース名・単価・数量・金額・備考をスナップショットする
--     (将来マスターの価格が変わっても過去の契約書は変わらない)。
--   * content_hash = 契約内容(申込内容・line_items・合計・署名画像のSHA-256)のSHA-256。
--     pdf_sha256 は保存したPDFファイル自体のSHA-256。
--   * Storage: 契約書専用の非公開バケット customer-contracts(PDFと署名PNGのみ許可)。
--     customer-photos(画像のみ)は変更しない。storage.objects にポリシーは作らない
--     (=anon/authenticatedは不可。service_roleのみAPI経由でアクセス)。
--
-- 適用は別途明示的な承認があるまで行わない(本ファイルはレビュー用に作成のみ)。
-- ================================================================

CREATE TABLE public.brain_customer_contracts (
  id               uuid        PRIMARY KEY,
  customer_id      uuid        NOT NULL REFERENCES public.brain_customers(id) ON DELETE RESTRICT,
  document_type    text        NOT NULL CHECK (document_type IN ('subscription', 'ticket')),
  application_date date        NOT NULL,
  name             text        NOT NULL,
  address          text        NOT NULL,
  phone_number     text        NOT NULL,
  line_items       jsonb       NOT NULL,
  total_amount     integer     NOT NULL CHECK (total_amount >= 0),
  pdf_path         text        NOT NULL,
  signature_path   text        NOT NULL,
  signature_sha256 text        NOT NULL,
  pdf_sha256       text        NOT NULL,
  content_hash     text        NOT NULL,
  template_version smallint    NOT NULL DEFAULT 1,
  created_by       uuid                 REFERENCES public.brain_staff(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ux_customer_contracts_pdf_path UNIQUE (pdf_path),
  CONSTRAINT ck_customer_contracts_line_items_array CHECK (jsonb_typeof(line_items) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_customer_contracts_customer_date
  ON public.brain_customer_contracts (customer_id, application_date DESC, created_at DESC);

ALTER TABLE public.brain_customer_contracts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bcc_select" ON public.brain_customer_contracts;
CREATE POLICY "bcc_select" ON public.brain_customer_contracts
  FOR SELECT TO service_role USING (true);

DROP POLICY IF EXISTS "bcc_insert" ON public.brain_customer_contracts;
CREATE POLICY "bcc_insert" ON public.brain_customer_contracts
  FOR INSERT TO service_role WITH CHECK (true);

-- UPDATE/DELETEのポリシーは作らない + 権限も付与しない(追記のみ)。
REVOKE ALL ON TABLE public.brain_customer_contracts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.brain_customer_contracts TO service_role;

COMMENT ON TABLE public.brain_customer_contracts IS
  '/karte 契約書・申込書(追記のみ)。line_itemsは保存時点のスナップショット。content_hashで改ざん確認。';

-- 契約書専用バケット(非公開、PDFと署名PNGのみ、10MB上限)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('customer-contracts', 'customer-contracts', false, 10485760, ARRAY['application/pdf', 'image/png'])
ON CONFLICT (id) DO NOTHING;
