-- ============================================================
-- LINE 送信ログテーブル
-- 目的: テスト送信・本番送信の全ログを記録する
-- ============================================================

CREATE TABLE IF NOT EXISTS public.line_send_logs (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- テスト/本番を明確に分離
  mode         text        NOT NULL DEFAULT 'test'
                           CHECK (mode IN ('test', 'production')),

  recipient_id text        NOT NULL,   -- LINE user ID (Uxxxxxxxxx...)
  message_body text        NOT NULL,   -- 実際に送信したメッセージ本文
  status       text        NOT NULL CHECK (status IN ('success', 'failed')),
  error_msg    text,                   -- 失敗時のエラー詳細 (成功時 NULL)

  sent_at      timestamptz NOT NULL DEFAULT now(),

  -- 将来の拡張ポイント: AI model名、prompt_id、campaign_id 等
  metadata     jsonb       NOT NULL DEFAULT '{}'
);

-- インデックス: 最新ログ順の表示用
CREATE INDEX IF NOT EXISTS idx_line_send_logs_sent_at
  ON public.line_send_logs (sent_at DESC);

-- インデックス: モード別フィルタ用
CREATE INDEX IF NOT EXISTS idx_line_send_logs_mode
  ON public.line_send_logs (mode, sent_at DESC);

-- RLS 有効化
ALTER TABLE public.line_send_logs ENABLE ROW LEVEL SECURITY;

-- 認証済みユーザーは全件参照可能
CREATE POLICY "authenticated_select" ON public.line_send_logs
  FOR SELECT TO authenticated USING (true);

-- service_role (API route) からの INSERT を許可
-- anon ロールには INSERT 不可（ブラウザから直接書き込めないようにする）
CREATE POLICY "service_role_insert" ON public.line_send_logs
  FOR INSERT TO service_role WITH CHECK (true);

-- テーブルレベル権限（RLSポリシーだけでは不十分。GRANTが無いとPostgRESTが
-- "permission denied" / "table not found in schema cache" を返す）
GRANT USAGE ON SCHEMA public TO authenticated, service_role;
GRANT SELECT ON TABLE public.line_send_logs TO authenticated;
GRANT SELECT, INSERT ON TABLE public.line_send_logs TO service_role;

COMMENT ON TABLE  public.line_send_logs IS 'LINE送信ログ。mode=test はテスト送信専用レコード。';
COMMENT ON COLUMN public.line_send_logs.mode IS 'test: テスト送信, production: 本番送信';
COMMENT ON COLUMN public.line_send_logs.metadata IS '将来拡張: AI model名・prompt_id・campaign_id 等を格納';
