-- ================================================================
-- Riora OS: line_user_ids テーブル作成
-- 実行: Supabase Dashboard > SQL Editor
--
-- 用途: LINE userId ↔ customers.id の名寄せテーブル。
--       Webhook の follow イベントで自動 INSERT される。
--       その後スタッフが customer_id を手動で紐付ける。
-- ================================================================

CREATE TABLE IF NOT EXISTS public.line_user_ids (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id    text        NOT NULL UNIQUE,
  display_name    text        NOT NULL DEFAULT '',
  picture_url     text,
  customer_id     uuid        REFERENCES public.customers(id) ON DELETE SET NULL,
  is_staff        boolean     NOT NULL DEFAULT false,
  staff_name      text,
  is_test_account boolean     NOT NULL DEFAULT false,
  followed_at     timestamptz NOT NULL DEFAULT now(),
  unfollowed_at   timestamptz,
  linked_at       timestamptz,           -- customer_id を紐付けた日時
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_line_user_ids_customer
  ON public.line_user_ids (customer_id);

CREATE INDEX IF NOT EXISTS idx_line_user_ids_followed
  ON public.line_user_ids (followed_at DESC);

-- updated_at 自動更新（関数は 20260606_create_line_send_queue.sql でも定義されるが、
-- 依存関係なく単独実行できるよう CREATE OR REPLACE で冪等に定義しておく）
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_line_user_ids_updated_at ON public.line_user_ids;
CREATE TRIGGER trg_line_user_ids_updated_at
  BEFORE UPDATE ON public.line_user_ids
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.line_user_ids ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_select" ON public.line_user_ids
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_insert" ON public.line_user_ids
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "authenticated_update" ON public.line_user_ids
  FOR UPDATE TO authenticated USING (true);

-- テーブルレベル権限（RLSポリシーだけでは不十分。service_role も
-- GRANT が無いと "permission denied" / "table not found in schema cache" になる）
GRANT USAGE ON SCHEMA public TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.line_user_ids TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.line_user_ids TO service_role;

COMMENT ON TABLE public.line_user_ids IS
  'LINE userId ↔ customers.id の名寄せ。Webhook の follow/unfollow で自動更新される。';
COMMENT ON COLUMN public.line_user_ids.customer_id IS
  'NULL = 未紐付け。スタッフが手動で顧客と紐付ける。';
COMMENT ON COLUMN public.line_user_ids.followed_at IS
  'LINE 公式アカウントを友だち追加した日時。';
