-- Migration: カルテメモ機能 — customer_karte_memos テーブル
-- 目的: スタッフが自由記述で残す長文カルテメモ(時系列・編集可・スタッフ記録付き)。
-- customer_memories(覚えておくこと)・customer_notes(AIノート+接客メモ)とは別物であり、
-- AI(ProposalOrchestrator/FireScore/TodayFocusCard等)からは一切参照・書き込みしない。
-- 実行場所: Supabase Dashboard > SQL Editor (単体適用。db push等の一括適用は使わない)

CREATE TABLE IF NOT EXISTS public.customer_karte_memos (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  uuid        NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  staff_id     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  content      text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_karte_memos_customer
  ON public.customer_karte_memos (customer_id, created_at DESC);

-- RLS: ポリシーは意図的に追加しない(anon/authenticatedロールからは一切アクセス不可の
-- デフォルト拒否)。全アクセスはservice role経由のAPIルート
-- (app/api/customer-karte-memos/**, canAccessCustomer()で権限確認)からのみ行う。
ALTER TABLE public.customer_karte_memos ENABLE ROW LEVEL SECURITY;

-- service_roleにはテーブル権限がデフォルトで自動付与されない(customer_notes等の既存テーブルと
-- 同様、GRANT漏れがあるとRLS以前にpermission deniedになる。timeline_summary_cache権限修正
-- インシデントと同種の既知の落とし穴のため、新規テーブル作成時は必ず明示的にGRANTする)。
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_karte_memos TO service_role;

COMMENT ON TABLE public.customer_karte_memos IS
  'スタッフ用カルテメモ(長文自由記述・時系列・編集可)。AI(ProposalOrchestrator/FireScore/TodayFocusCard等)からは参照・書き込み禁止。';

-- 確認:
-- SELECT * FROM public.customer_karte_memos ORDER BY created_at DESC LIMIT 20;
