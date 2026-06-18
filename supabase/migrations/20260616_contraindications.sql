-- ─── contraindications テーブル ─────────────────────────────────────────────
-- 顧客の施術禁忌・注意事項を AI が自動抽出して保存する。
-- customer_id + title の組み合わせで重複判定し UPSERT する。

CREATE TABLE IF NOT EXISTS public.contraindications (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id      uuid         NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  reservation_id   uuid                  REFERENCES public.reservations(id) ON DELETE SET NULL,
  store_id         uuid,        -- nullable（シングルストア実態）
  severity         text         NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  title            text         NOT NULL,
  description      text,
  recommendation   text,
  source           text,
  source_note_id   uuid,        -- customer_notes.id または voice_notes.id
  confidence       numeric(4,3) NOT NULL DEFAULT 0,
  generated_at     timestamptz  NOT NULL DEFAULT now(),
  created_at       timestamptz  NOT NULL DEFAULT now()
);

-- ─── インデックス ────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS contraindications_customer_id_idx
  ON public.contraindications (customer_id);

CREATE INDEX IF NOT EXISTS contraindications_reservation_id_idx
  ON public.contraindications (reservation_id);

CREATE INDEX IF NOT EXISTS contraindications_store_id_idx
  ON public.contraindications (store_id);

CREATE INDEX IF NOT EXISTS contraindications_severity_idx
  ON public.contraindications (severity);

-- ─── RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE public.contraindications ENABLE ROW LEVEL SECURITY;

CREATE POLICY ci_select ON public.contraindications
  FOR SELECT TO authenticated USING (true);

CREATE POLICY ci_insert ON public.contraindications
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY ci_update ON public.contraindications
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
