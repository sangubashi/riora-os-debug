-- Migration: サブスク決済／実来店 分離 Phase 1 — brain_subscription_payments テーブル
--
-- 背景: SalonBoard売上明細CSVの「区分=施術」行には、実際の施術とサブスク月額課金
-- （【サブスク決済日】※金額入力してお会計 等、確認済みだけで12パターン）が
-- 区別なく混在している。従来はこれらもbrain_visits.treatment_amountへ合算され、
-- 来店回数(visit_count_at)・来店周期・次回の目安・顧客ステータス機能・売上分析の
-- 全てを汚染していた（実データ調査で342会計中136会計(約40%)がサブスク関連行を含み、
-- うち60会計は実施術行と同一会計に混在=治療費への無自覚な混入を確認済み）。
--
-- 本テーブルはbrain_visit_retail_itemsと同じ「明細単位で分離して保持する」方針を
-- 踏襲し、サブスク課金の明細行をbrain_visitsの外側に切り出す。
--
-- customer_idを直接保持する(brain_visit_retail_itemsと異なりvisit_id経由のJOINに
-- 頼らない): 「純粋サブスク会計」(実施術・店販を伴わない決済のみの会計)は
-- brain_visitsの行を一切作らない設計のため、visit_idがnullになるケースがある。
--
-- Phase 1のスコープ: 今後の新規CSV取込分から適用。既存データの遡及是正・
-- visit_count_atの再採番はPhase 2で別途対応する。

CREATE TABLE IF NOT EXISTS public.brain_subscription_payments (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id     uuid        NOT NULL REFERENCES public.brain_stores(id) ON DELETE CASCADE,
  customer_id  uuid        NOT NULL REFERENCES public.brain_customers(id) ON DELETE CASCADE,
  -- 実施術・店販が同一会計に混在していた場合、その会計から作られたbrain_visitsの行を指す。
  -- 「純粋サブスク会計」(決済のみ・他の明細なし)の場合はnull(=どの来店にも属さない)。
  visit_id     uuid        REFERENCES public.brain_visits(id) ON DELETE SET NULL,
  staff_id     uuid        REFERENCES public.brain_staff(id) ON DELETE SET NULL,
  -- SalonBoardの会計ID。同一CSVの再取込時にreplace(delete→insert)する単位として使う
  -- (brain_visit_retail_itemsがvisit_id単位でreplaceするのと同じ考え方)。
  checkout_id  text        NOT NULL,
  item_name    text        NOT NULL,
  amount       integer     NOT NULL,
  payment_date date        NOT NULL,
  source       text        NOT NULL DEFAULT 'salonboard_import',
  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_brain_subscription_payments_customer
  ON public.brain_subscription_payments (customer_id, payment_date);

CREATE INDEX IF NOT EXISTS idx_brain_subscription_payments_checkout
  ON public.brain_subscription_payments (checkout_id);

CREATE INDEX IF NOT EXISTS idx_brain_subscription_payments_visit
  ON public.brain_subscription_payments (visit_id);

-- RLS: 本プロジェクトの標準パターン(brain_visit_retail_items/customer_karte_memos等)を
-- 踏襲し、ポリシーは意図的に追加せず、anon/authenticatedロールからは一切アクセス不可の
-- デフォルト拒否とする。全アクセスはservice role経由のAPIルート・CSV取込パイプラインのみ。
ALTER TABLE public.brain_subscription_payments ENABLE ROW LEVEL SECURITY;

-- service_roleにはテーブル権限がデフォルトで自動付与されない
-- (timeline_summary_cache権限修正インシデントと同種の既知の落とし穴のため、
-- 新規テーブル作成時は必ず明示的にGRANTする)。
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brain_subscription_payments TO service_role;

COMMENT ON TABLE public.brain_subscription_payments IS
  'CSV取込(SalonBoard)由来のサブスク月額課金明細。brain_visits.treatment_amountから
   分離して保持する(サブスク決済／実来店データモデル分離 Phase 1)。
   visit_idは実施術・店販と同一会計だった場合のみ設定(混在会計)、
   決済のみの会計(純粋サブスク会計)ではnull。';
