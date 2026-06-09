-- ============================================================
-- line_send_logs への GRANT 追加（パッチ）
--
-- 20260605_line_send_logs.sql は RLS ポリシーのみ作成しており、
-- テーブルレベルの GRANT が無いため、PostgREST から
-- "permission denied for table line_send_logs" /
-- "Could not find the table 'public.line_send_logs' in the schema cache"
-- が発生していた。
-- ============================================================

GRANT USAGE ON SCHEMA public TO authenticated, service_role;
GRANT SELECT ON TABLE public.line_send_logs TO authenticated;
GRANT SELECT, INSERT ON TABLE public.line_send_logs TO service_role;
