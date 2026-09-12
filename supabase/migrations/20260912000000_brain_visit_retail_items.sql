-- Migration: 顧客ステータス機能 — brain_visit_retail_items テーブル
-- 目的: CSV取込時に brain_visits.retail_category/retail_amount へ集計・合算する際に
-- 失われている「商品ごとの購入明細(商品名・数量・単価・金額)」を保持する。
-- brain_visits.retail_category(商品名を"/"で結合)・retail_amount(来店1回の合算額)は
-- 無変更のまま維持し、本テーブルは追加の明細情報として並存する。
-- 実行場所: Supabase Dashboard > SQL Editor (単体適用。db push等の一括適用は使わない)

CREATE TABLE IF NOT EXISTS public.brain_visit_retail_items (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id     uuid        NOT NULL REFERENCES public.brain_visits(id) ON DELETE CASCADE,
  product_name text        NOT NULL,
  quantity     integer     NOT NULL DEFAULT 1,
  unit_price   integer,
  amount       integer,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- 購入日は独立カラムを持たず、visit_id → brain_visits.visit_date を参照する
-- (将来「来店日と別に店販購入」の運用が発生した場合はpurchased_at追加を検討)。
CREATE INDEX IF NOT EXISTS idx_brain_visit_retail_items_visit
  ON public.brain_visit_retail_items (visit_id);

-- 商品別の購入履歴・購入周期の集計(customer横断)のためのインデックス。
-- customer_idはbrain_visits経由でしか引けないため、product_nameだけの単純indexに留める
-- (customer_id列を非正規化して持たない設計。JOIN前提)。
CREATE INDEX IF NOT EXISTS idx_brain_visit_retail_items_product
  ON public.brain_visit_retail_items (product_name);

-- RLS: customer_karte_memos/karte_imports と同じ方針(ポリシーは意図的に追加せず、
-- anon/authenticatedロールからは一切アクセス不可のデフォルト拒否)。
-- 全アクセスはservice role経由のAPIルート・CSV取込パイプラインからのみ行う。
ALTER TABLE public.brain_visit_retail_items ENABLE ROW LEVEL SECURITY;

-- service_roleにはテーブル権限がデフォルトで自動付与されない(timeline_summary_cache
-- 権限修正インシデントと同種の既知の落とし穴のため、新規テーブル作成時は必ず明示的にGRANTする)。
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brain_visit_retail_items TO service_role;

COMMENT ON TABLE public.brain_visit_retail_items IS
  'CSV取込(SalonBoard)由来の来店ごとの店販購入明細(商品名・数量・単価・金額)。brain_visits.retail_category/retail_amountの集計元にあたる明細データ。';

-- 確認:
-- SELECT * FROM public.brain_visit_retail_items ORDER BY created_at DESC LIMIT 20;
