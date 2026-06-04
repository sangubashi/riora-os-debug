-- Migration: PHASE 3 — voice_notes インサイトカラム追加
-- 目的: 音声メモをAI分析可能な"知識データ"へ変換するための土台
-- 実行場所: Supabase Dashboard > SQL Editor

-- ─── voice_notes にインサイトカラム追加 ──────────────────────────────────────

-- insight_tags: 抽出済みタグ配列
ALTER TABLE public.voice_notes
  ADD COLUMN IF NOT EXISTS insight_tags text[] DEFAULT '{}';

-- analysis_status: 解析ステータス管理
ALTER TABLE public.voice_notes
  ADD COLUMN IF NOT EXISTS analysis_status text NOT NULL DEFAULT 'pending'
  CHECK (analysis_status IN ('pending', 'processing', 'completed', 'failed'));

-- analyzed_at: 解析完了日時
ALTER TABLE public.voice_notes
  ADD COLUMN IF NOT EXISTS analyzed_at timestamptz;

-- インデックス（タグ検索・未解析フィルタ用）
CREATE INDEX IF NOT EXISTS idx_voice_notes_insight_tags
  ON public.voice_notes USING GIN (insight_tags);

CREATE INDEX IF NOT EXISTS idx_voice_notes_analysis_status
  ON public.voice_notes (analysis_status, created_at DESC);

-- ─── action_logs CHECK 制約を更新（voice_insight_generated 追加） ────────────
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
      'voice_note_created',
      'voice_insight_generated'
    )
  );

-- ─── 顧客インサイト集計ビュー ────────────────────────────────────────────────
-- 顧客ごとに直近30日のインサイトタグを集計
CREATE OR REPLACE VIEW public.customer_insight_summary AS
SELECT
  customer_id,
  unnest(insight_tags)                                    AS tag,
  COUNT(*)                                                AS tag_count,
  MAX(created_at)                                         AS last_seen_at
FROM public.voice_notes
WHERE
  insight_tags IS NOT NULL
  AND array_length(insight_tags, 1) > 0
  AND created_at >= NOW() - INTERVAL '90 days'
GROUP BY customer_id, tag
ORDER BY customer_id, tag_count DESC;

-- 確認クエリ:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'voice_notes'
-- ORDER BY ordinal_position;
--
-- SELECT * FROM public.customer_insight_summary LIMIT 20;
