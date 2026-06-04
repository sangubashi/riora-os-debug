-- Migration: PHASE 4.6 — customer_memories テーブル
-- 目的: 音声メモから抽出した顧客の「記憶」を蓄積し、次回来店時に自然表示
-- 実行場所: Supabase Dashboard > SQL Editor

CREATE TABLE IF NOT EXISTS public.customer_memories (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  uuid        NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  category     text        NOT NULL CHECK (category IN ('hobby','event','skin','life','preference')),
  content      text        NOT NULL,
  source       text        NOT NULL DEFAULT 'voice_note' CHECK (source IN ('voice_note','manual')),
  confidence   float4      NOT NULL DEFAULT 0.7 CHECK (confidence >= 0 AND confidence <= 1),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_customer_memories_customer
  ON public.customer_memories (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_memories_category
  ON public.customer_memories (category);

-- RLS
ALTER TABLE public.customer_memories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "memories_read" ON public.customer_memories
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid())
  );

CREATE POLICY "memories_insert" ON public.customer_memories
  FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid())
  );

-- 確認:
-- SELECT * FROM public.customer_memories ORDER BY created_at DESC LIMIT 20;
