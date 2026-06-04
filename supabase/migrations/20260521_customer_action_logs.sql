-- Migration: customer_action_logs テーブル作成
-- 目的: スタッフ行動を蓄積し「成功パターン学習OS」の基盤データとする
-- 実行場所: Supabase Dashboard > SQL Editor

CREATE TABLE IF NOT EXISTS public.customer_action_logs (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    uuid        NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  staff_id       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  action_type    text        NOT NULL,
  action_payload jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- action_type 制約
ALTER TABLE public.customer_action_logs
  ADD CONSTRAINT chk_action_type CHECK (
    action_type IN (
      'line_sent',
      'homecare_explained',
      'rebook_recommended',
      'product_recommended',
      'product_purchased'
    )
  );

-- インデックス（顧客別・日付順の集計クエリ用）
CREATE INDEX IF NOT EXISTS idx_cal_customer_id
  ON public.customer_action_logs (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cal_staff_id
  ON public.customer_action_logs (staff_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cal_action_type
  ON public.customer_action_logs (action_type, created_at DESC);

-- RLS 有効化
ALTER TABLE public.customer_action_logs ENABLE ROW LEVEL SECURITY;

-- ポリシー: staff は自分の行 + owner は全件
CREATE POLICY "staff_own_logs" ON public.customer_action_logs
  FOR ALL
  USING (
    staff_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'owner'
    )
  );

-- ポリシー: INSERT は認証済みユーザーのみ（staff_id = auth.uid() を強制）
CREATE POLICY "insert_own_log" ON public.customer_action_logs
  FOR INSERT
  WITH CHECK (staff_id = auth.uid());

-- KPI集計ビュー（提案率・LINE送信率などをリアルタイム集計）
CREATE OR REPLACE VIEW public.action_log_summary AS
SELECT
  DATE_TRUNC('day', created_at AT TIME ZONE 'Asia/Tokyo') AS log_date,
  staff_id,
  action_type,
  COUNT(*)                                                  AS action_count,
  COUNT(DISTINCT customer_id)                               AS unique_customers
FROM public.customer_action_logs
GROUP BY 1, 2, 3;

-- 確認クエリ:
-- SELECT * FROM public.customer_action_logs ORDER BY created_at DESC LIMIT 20;
-- SELECT * FROM public.action_log_summary ORDER BY log_date DESC;
