-- ================================================================
-- Riora OS: line_send_queue テーブル作成
-- 実行: Supabase Dashboard > SQL Editor
--
-- 用途: LINE半自動送信の承認待ちキュー。
--   semi  モード → status='pending' で登録 → スタッフ承認後に送信
--   auto  モード → status='approved' で登録 → 即時送信（将来実装）
--   test  モード → 久保田さん自身へのテスト送信
-- ================================================================

CREATE TABLE IF NOT EXISTS public.line_send_queue (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     uuid        REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name   text        NOT NULL DEFAULT '',
  line_user_id    text        NOT NULL DEFAULT '',
  message_body    text        NOT NULL,
  send_mode       text        NOT NULL DEFAULT 'semi'
                  CHECK (send_mode IN ('test', 'staff_notify', 'semi', 'auto')),
  status          text        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'sent', 'failed', 'skipped')),
  approved_by     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at     timestamptz,
  scheduled_at    timestamptz,
  triggered_by    text,       -- 'churn_risk' | 'manual' | 'anniversary' 等
  template_id     text,
  error_message   text,
  sent_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_line_send_queue_status
  ON public.line_send_queue (status);

CREATE INDEX IF NOT EXISTS idx_line_send_queue_customer
  ON public.line_send_queue (customer_id);

CREATE INDEX IF NOT EXISTS idx_line_send_queue_created
  ON public.line_send_queue (created_at DESC);

-- updated_at 自動更新トリガー
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_line_send_queue_updated_at ON public.line_send_queue;
CREATE TRIGGER trg_line_send_queue_updated_at
  BEFORE UPDATE ON public.line_send_queue
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.line_send_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_select" ON public.line_send_queue
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_insert" ON public.line_send_queue
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "authenticated_update" ON public.line_send_queue
  FOR UPDATE TO authenticated USING (true);

-- テーブルレベル権限（RLSポリシーだけでは不十分。service_role も
-- GRANT が無いと "permission denied" / "table not found in schema cache" になる）
GRANT USAGE ON SCHEMA public TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.line_send_queue TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.line_send_queue TO service_role;

-- コメント
COMMENT ON TABLE public.line_send_queue IS
  'LINE半自動送信キュー。semi モードは approved になるまで送信しない。';
COMMENT ON COLUMN public.line_send_queue.send_mode IS
  'test=自分へのテスト / staff_notify=スタッフ通知 / semi=承認後送信 / auto=自動送信';
COMMENT ON COLUMN public.line_send_queue.status IS
  'pending=承認待ち / approved=承認済 / sent=送信完了 / failed=失敗 / skipped=スキップ';
