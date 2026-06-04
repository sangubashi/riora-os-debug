-- Migration: store_patterns テーブル再定義
-- 目的: SuccessPattern 型（storeLearning.ts）に完全対応したスキーマ
-- 実行場所: Supabase Dashboard > SQL Editor
-- 注意: 既存の store_patterns テーブルを DROP → 再作成

DROP TABLE IF EXISTS public.store_patterns CASCADE;

CREATE TABLE public.store_patterns (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 顧客・スタッフ
  customer_id      uuid        REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_tags    text[]      NOT NULL DEFAULT '{}',
  staff_id         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  staff_name       text,

  -- アクション分類
  action_type      text        NOT NULL,   -- 'ホームケア提案' | '商品提案' | '再来提案' | ...
  action_content   text        NOT NULL DEFAULT '',
  action_category  text,

  -- 成果指標
  re_visit_rate    float4,
  line_reply_rate  float4,
  sales_up         float4,
  success_score    integer     NOT NULL DEFAULT 0 CHECK (success_score BETWEEN 0 AND 100),
  qualitative_feedback text,

  -- コンテキスト
  ctx_season       text,
  ctx_concerns     text[],
  ctx_insight_tags text[],
  ctx_relationship_state text,
  ctx_visit_cycle_days   integer,
  ctx_time_of_day  text,

  -- タイミング
  minutes_after_service integer,
  before_checkout  boolean     DEFAULT false,
  service_type     text,

  -- スタッフスタイル
  staff_style      text        NOT NULL DEFAULT '共感型'
                   CHECK (staff_style IN ('共感型','提案型','分析型','癒し型','ストレート型')),

  -- 統計
  effectiveness    float4      NOT NULL DEFAULT 0 CHECK (effectiveness BETWEEN 0 AND 1),
  sample_size      integer     NOT NULL DEFAULT 0,

  -- タイムスタンプ
  last_updated     timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- インデックス
CREATE INDEX idx_sp_customer_tags  ON public.store_patterns USING GIN (customer_tags);
CREATE INDEX idx_sp_action_type    ON public.store_patterns (action_type);
CREATE INDEX idx_sp_effectiveness  ON public.store_patterns (effectiveness DESC);
CREATE INDEX idx_sp_staff_id       ON public.store_patterns (staff_id);

-- RLS
ALTER TABLE public.store_patterns ENABLE ROW LEVEL SECURITY;

-- 全認証ユーザーが閲覧可（店舗共有データ）
CREATE POLICY "sp_read" ON public.store_patterns
  FOR SELECT USING (auth.role() = 'authenticated');

-- owner / admin のみ書き込み可
CREATE POLICY "sp_write" ON public.store_patterns
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('owner','admin')
    )
  );

-- 確認:
-- SELECT action_type, count(*), avg(effectiveness)
-- FROM public.store_patterns
-- GROUP BY action_type ORDER BY 2 DESC;
