-- Migration: PHASE 8 — store_patterns キャッシュテーブル
-- 目的: 成功パターン集計結果をキャッシュして高速参照
-- 実行場所: Supabase Dashboard > SQL Editor

CREATE TABLE IF NOT EXISTS public.store_patterns (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  outcome       text        NOT NULL,   -- 'repeat' | 'purchase' | 'vip' | 'line_reply'
  menu_name     text,
  action_seq    text[]      NOT NULL,   -- 成功アクションシーケンス
  count         integer     NOT NULL DEFAULT 1,
  confidence    float4      NOT NULL DEFAULT 0.5,
  cached_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_outcome CHECK (outcome IN ('repeat','purchase','vip','line_reply','referral'))
);

CREATE INDEX IF NOT EXISTS idx_store_patterns_outcome ON public.store_patterns (outcome, count DESC);

-- RLS: 認証ユーザーはすべて閲覧可（店舗共有データ）
ALTER TABLE public.store_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "store_patterns_read" ON public.store_patterns
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "store_patterns_write" ON public.store_patterns
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','admin'))
  );

-- staff_logs に customer_type カラムがない場合の確認
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'staff_logs';
