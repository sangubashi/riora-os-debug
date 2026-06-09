-- ================================================================
-- Riora OS: voice_notes に InsightGenerator 出力カラムを追加
-- 実行: Supabase Dashboard > SQL Editor
--
-- 追加カラム:
--   next_suggestion  次回提案施術名（InsightGenerator の最優先提案）
--   ng_topics        NGトピックリスト JSON配列
--   buy_tendency     購入傾向タグリスト JSON配列
--   insight_summary  1行サマリー（InsightGenerator.summary）
-- ================================================================

ALTER TABLE public.voice_notes
  ADD COLUMN IF NOT EXISTS next_suggestion  text,
  ADD COLUMN IF NOT EXISTS ng_topics        jsonb  DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS buy_tendency     jsonb  DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS insight_summary  text;

COMMENT ON COLUMN public.voice_notes.next_suggestion IS
  'InsightGenerator が抽出した最優先の次回提案施術名';
COMMENT ON COLUMN public.voice_notes.ng_topics IS
  'NGワードトピックリスト: [{ tag, topic, severity }]';
COMMENT ON COLUMN public.voice_notes.buy_tendency IS
  '購入傾向タグリスト: [{ tag, style }]';
COMMENT ON COLUMN public.voice_notes.insight_summary IS
  'InsightGenerator の1行サマリー。接客ログ一覧での表示用';
