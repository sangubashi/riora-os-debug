-- ================================================================
-- customers テーブルに不足しているカラムを追加
--
-- 背景:
--   SalonBoardSaveEngine.ts が参照しているカラムが DB に存在せず
--   CSV インポート時に全件 INSERT エラーになる。
--   また CustomerBottomSheet が skin_tags を SELECT/UPDATE しているが
--   カラムが存在しないためリアルタイムエラーが発生している。
--
-- 冪等: ADD COLUMN IF NOT EXISTS のため再実行安全
-- ================================================================

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS customer_hash_id    text,
  ADD COLUMN IF NOT EXISTS avg_price           integer,
  ADD COLUMN IF NOT EXISTS skin_tags           text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS line_response_rate  integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vip_rank            integer DEFAULT 0;

-- customer_hash_id は CSV 名寄せキー。NULL は除外した UNIQUE 制約
CREATE UNIQUE INDEX IF NOT EXISTS customers_customer_hash_id_key
  ON public.customers (customer_hash_id)
  WHERE customer_hash_id IS NOT NULL;

-- 確認クエリ:
-- SELECT column_name, data_type, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'customers' AND table_schema = 'public'
-- ORDER BY ordinal_position;
