-- ================================================================
-- 2026-06-21: Phase 2 — CSV Import DB差分
--   brain_customers: prefecture / city / external_key_hash 追加
--   brain_ops_logs: 新設(CSV取込等の汎用運用ログ・PIIゼロ契約)
--
-- 設計根拠:
--   - docs/architecture/CSVImportSecurityArchitecture.md §6
--     (Master Schema差分・ColumnPolicy/PiiSanitizer/AddressTruncator)
--   - README.md「実装着手の前提」(新規業務テーブルは作らない)
--   - 2026-06-20のCSV Import設計レビューでbrain_*方針(トラックB)を正式採用
--     (素のcustomers/reservations/profiles前提だった旧設計・旧migration
--      20260619_csv_import_*.sql 4本は廃止・本ファイルが正)
--
-- 制約:
--   - 新規業務テーブルは作らない。brain_ops_logsは「業務エンティティ」ではなく
--     運用監査ログ(infra)であり、CSV Import専用ではなく将来の他運用イベントにも
--     汎用的に使う想定(kind列で種別を区別)。
--   - 冪等性: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS /
--     CREATE INDEX IF NOT EXISTS / DROP POLICY IF EXISTS を徹底し、
--     再実行しても安全(既存データへの破壊的変更なし)。
--   - brain_接頭辞の命名規則を厳密に守る(新設テーブルはbrain_ops_logsのみ)。
--   - detail jsonbにセル値・氏名・行内容等のPIIを一切含めない契約
--     (CSVImportSecurityArchitecture.md §4)。この契約はDBスキーマでは
--     強制できないため、書き込み側(TypeScript/API実装)の責務とする。
--     恒久的なCI検査(anti-schema test・S-8相当)は次フェーズ(API実装時)に追加する。
--
-- 適用状態: 未適用(このファイルはレビュー用。承認後に別途適用する)
-- ================================================================

-- ---------------------------------------------------------------
-- 1. brain_customers: 名寄せ用ハッシュキー・粗い居住地情報の追加
-- ---------------------------------------------------------------

ALTER TABLE public.brain_customers
  ADD COLUMN IF NOT EXISTS prefecture text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS external_key_hash text;

COMMENT ON COLUMN public.brain_customers.prefecture IS
  'CSV取込元(SalonBoard等)の都道府県。市区町村より粗い情報のみ保持し、'
  '番地・建物名等は破棄する(CSVImportSecurityArchitecture.mdのAddressTruncator仕様)。';

COMMENT ON COLUMN public.brain_customers.city IS
  'CSV取込元の市区町村まで。番地・建物名・郵便番号は保持しない(AddressTruncator仕様)。';

COMMENT ON COLUMN public.brain_customers.external_key_hash IS
  'CSV取込元システム(SalonBoard会員番号等)由来のハッシュ化済み外部キー。'
  '生の電話番号・メール・会員番号そのものは保持しない(PiiSanitizer仕様)。'
  'store_id単位でUNIQUE(下記インデックス参照)。NULL許容(キーが取れないCSV行のため)。';

-- アンチスキーマ宣言(恒久・CSVImportSecurityArchitecture.md準拠):
-- brain_customersには phone / email / postal_code / address_line / building / room
-- のいずれの列も存在しない。これらの列を追加するmigrationを将来書く場合、
-- 本宣言と矛盾するため設計レビューを必須とすること(anti-schema CI検査は
-- API実装フェーズで自動化する)。

CREATE UNIQUE INDEX IF NOT EXISTS uq_brain_customers_external_key
  ON public.brain_customers (store_id, external_key_hash)
  WHERE external_key_hash IS NOT NULL;

-- ---------------------------------------------------------------
-- 2. brain_ops_logs: 新設(汎用運用ログ・brain_接頭辞・PIIゼロ)
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.brain_ops_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid NOT NULL REFERENCES public.brain_stores(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  actor_id    uuid,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.brain_ops_logs IS
  '汎用運用監査ログ(brain_接頭辞・業務テーブルではなくinfra)。'
  'CSV Import実行結果(kind=''csv_import'')を主用途とするが、将来の他運用イベント'
  '(例: kind=''batch_reconcile''等)にも流用可能な汎用設計。'
  'detailにはセル値・氏名・行内容等のPIIを一切含めない契約'
  '(CSVImportSecurityArchitecture.md §4・書き込み側TypeScriptの責務)。';

COMMENT ON COLUMN public.brain_ops_logs.kind IS
  'ログ種別。例: ''csv_import''。フィルタ用途のため下記複合インデックスの対象。';

COMMENT ON COLUMN public.brain_ops_logs.actor_id IS
  '実行者のauth.users.id。service_role経由のバッチ実行時はNULL許容。';

COMMENT ON COLUMN public.brain_ops_logs.detail IS
  '構造化された結果サマリ(PIIゼロ契約)。例: {"file_name_hash": "...", '
  '"total_rows": 158, "new_customers": 12, "updated_customers": 38, '
  '"unresolved_staff_count": 0}。セル値・顧客氏名・行内容そのものは含めない。';

CREATE INDEX IF NOT EXISTS idx_brain_ops_logs_store_kind
  ON public.brain_ops_logs (store_id, kind, created_at DESC);

-- ---------------------------------------------------------------
-- 3. brain_ops_logs RLS(店舗分離+owner専用read・書込はservice_role限定)
-- ---------------------------------------------------------------

ALTER TABLE public.brain_ops_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS brain_ops_logs_owner_read ON public.brain_ops_logs;
CREATE POLICY brain_ops_logs_owner_read ON public.brain_ops_logs
  FOR SELECT
  USING (store_id = public.app_store_id() AND public.is_owner());

-- INSERT/UPDATE/DELETEポリシーは意図的に定義しない。
-- service_role(RLSバイパス)のみが書込可能。authenticated/anonは
-- 下記GRANTがあってもポリシー無しのため書込は常に拒否される
-- (20260612000005_rls_policies.sqlのbrain_events/brain_revisionsと同じ
--  「ポリシー無し=書込0件・service_roleのみ書込可」パターンに統一)。

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.brain_ops_logs TO authenticated, service_role;
