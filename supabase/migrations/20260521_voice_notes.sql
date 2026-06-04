-- Migration: voice_notes テーブル作成
-- 目的: スタッフの接客後音声を蓄積し、未来のAI分析素材とする
-- 実行場所: Supabase Dashboard > SQL Editor

-- ─── テーブル ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.voice_notes (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    uuid        NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  staff_id       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  reservation_id uuid        REFERENCES public.reservations(id) ON DELETE SET NULL,
  storage_path   text        NOT NULL,         -- voice-notes/{staff_id}/{customer_id}/{timestamp}.webm
  transcript     text,                         -- 将来: Whisper等で自動文字起こし
  summary        text,                         -- 将来: AI要約
  duration_sec   integer,                      -- 録音秒数
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_voice_notes_customer
  ON public.voice_notes (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_voice_notes_staff
  ON public.voice_notes (staff_id, created_at DESC);

-- RLS 有効化
ALTER TABLE public.voice_notes ENABLE ROW LEVEL SECURITY;

-- ポリシー: staff は自分の行、owner は全件
CREATE POLICY "voice_notes_read" ON public.voice_notes
  FOR SELECT
  USING (
    staff_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'owner'
    )
  );

CREATE POLICY "voice_notes_insert" ON public.voice_notes
  FOR INSERT
  WITH CHECK (staff_id = auth.uid());

CREATE POLICY "voice_notes_delete" ON public.voice_notes
  FOR DELETE
  USING (staff_id = auth.uid());

-- ─── Storage bucket（Supabase Dashboard で手動作成が必要） ──────────────────
-- Dashboard > Storage > New bucket
-- Name: voice-notes
-- Public: OFF（プライベート）
-- File size limit: 10MB
-- Allowed MIME types: audio/webm, audio/mp4, audio/ogg

-- Storage RLS ポリシー（Dashboard > Storage > voice-notes > Policies）:
-- INSERT: (auth.uid() = owner) ... bucket_id = 'voice-notes' AND auth.role() = 'authenticated'
-- SELECT: staff_id = auth.uid() OR owner role
-- DELETE: staff_id = auth.uid()

-- ─── action_logs の CHECK 制約を更新（voice_note_created 追加） ────────────
-- 既存制約を削除して再作成
ALTER TABLE public.customer_action_logs
  DROP CONSTRAINT IF EXISTS chk_action_type;

ALTER TABLE public.customer_action_logs
  ADD CONSTRAINT chk_action_type CHECK (
    action_type IN (
      'line_sent',
      'homecare_explained',
      'rebook_recommended',
      'product_recommended',
      'product_purchased',
      'voice_note_created'
    )
  );

-- 確認クエリ:
-- SELECT * FROM public.voice_notes ORDER BY created_at DESC LIMIT 10;
-- \d public.voice_notes
