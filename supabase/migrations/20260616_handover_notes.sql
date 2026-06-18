-- ─── handover_notes テーブル ────────────────────────────────────────────────
-- 担当スタッフ変更時の AI 引継ぎノートを保存する。
-- customer_id + reservation_id の組み合わせで重複判定し UPSERT する。

CREATE TABLE IF NOT EXISTS public.handover_notes (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id         uuid        NOT NULL REFERENCES public.customers(id)    ON DELETE CASCADE,
  reservation_id      uuid                 REFERENCES public.reservations(id) ON DELETE SET NULL,
  store_id            uuid,       -- nullable（シングルストア実態）
  summary             text        NOT NULL DEFAULT '',
  customer_context    jsonb       NOT NULL DEFAULT '[]'::jsonb,
  open_tasks          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  recommended_actions jsonb       NOT NULL DEFAULT '[]'::jsonb,
  risk_flags          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  confidence          numeric(4,3) NOT NULL DEFAULT 0,
  generated_at        timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- ─── インデックス ────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS handover_notes_customer_id_idx
  ON public.handover_notes (customer_id);

CREATE INDEX IF NOT EXISTS handover_notes_reservation_id_idx
  ON public.handover_notes (reservation_id);

CREATE INDEX IF NOT EXISTS handover_notes_store_id_idx
  ON public.handover_notes (store_id);

CREATE INDEX IF NOT EXISTS handover_notes_generated_at_idx
  ON public.handover_notes (generated_at DESC);

-- ─── RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE public.handover_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY hn_select ON public.handover_notes
  FOR SELECT TO authenticated USING (true);

CREATE POLICY hn_insert ON public.handover_notes
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY hn_update ON public.handover_notes
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
