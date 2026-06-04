-- Migration: customers テーブルに ホームケア伴走カラムを追加
-- 実行場所: Supabase Dashboard > SQL Editor

-- 肌タグ（文字列配列）
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS skin_tags text[] DEFAULT '{}';

-- ホームケアメモ（テキスト）
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS homecare_notes text;

-- 推奨来店サイクル日数（整数、NULLならメニューから自動算出）
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS recommended_cycle_days integer;

-- 最終購入商品（JSONB: { name, purchasedAt, category }）
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS last_product_purchase jsonb;

-- インデックス（skin_tagsでの絞り込み用）
CREATE INDEX IF NOT EXISTS idx_customers_skin_tags
  ON public.customers USING GIN (skin_tags);

-- RLS: skin_tags / homecare_notes は既存ポリシーを継承（追加設定不要）
-- 確認コマンド:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'customers' AND column_name IN
--   ('skin_tags','homecare_notes','recommended_cycle_days','last_product_purchase');
