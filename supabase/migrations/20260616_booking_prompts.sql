-- ================================================================
-- booking_prompts テーブル
-- 目的: 来店前に顧客の Customer Notes / Voice Notes を集約し、
--       スタッフへ「今日の接客ポイント」を自動提示する。
--
-- 生成タイミング:
--   - CustomerBottomSheet を開いた時（未生成なら生成）
--   - Voice Memo の AI 解析完了後に再生成
-- ================================================================

CREATE TABLE IF NOT EXISTS public.booking_prompts (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id           uuid        NOT NULL
                                      REFERENCES public.customers(id)
                                      ON DELETE CASCADE,
  reservation_id        uuid        REFERENCES public.reservations(id)
                                      ON DELETE SET NULL,
  -- store_id: 将来の多店舗対応用。現在は単一店舗のため nullable
  store_id              uuid,

  summary               text        NOT NULL DEFAULT '',

  -- JSONB 配列: 会話トピック候補・提案候補・注意フラグ
  recommended_topics    jsonb       NOT NULL DEFAULT '[]'::jsonb,
  recommended_proposals jsonb       NOT NULL DEFAULT '[]'::jsonb,
  risk_flags            jsonb       NOT NULL DEFAULT '[]'::jsonb,

  -- 0.0〜1.0: データ量に基づく信頼度
  confidence            numeric(4,3) NOT NULL DEFAULT 0,

  generated_at          timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- ─── インデックス ─────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_booking_prompts_customer
  ON public.booking_prompts (customer_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_booking_prompts_reservation
  ON public.booking_prompts (reservation_id)
  WHERE reservation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_booking_prompts_store
  ON public.booking_prompts (store_id)
  WHERE store_id IS NOT NULL;

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.booking_prompts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bp_select" ON public.booking_prompts;
DROP POLICY IF EXISTS "bp_insert" ON public.booking_prompts;
DROP POLICY IF EXISTS "bp_update" ON public.booking_prompts;

-- 全認証ユーザーが参照可（単一サロン設計）
CREATE POLICY "bp_select" ON public.booking_prompts
  FOR SELECT USING (auth.role() = 'authenticated');

-- 認証ユーザーが INSERT 可（自動生成）
CREATE POLICY "bp_insert" ON public.booking_prompts
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- 認証ユーザーが UPDATE 可（再生成時の上書き）
CREATE POLICY "bp_update" ON public.booking_prompts
  FOR UPDATE USING (auth.role() = 'authenticated');
