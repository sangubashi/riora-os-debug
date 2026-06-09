-- ================================================================
-- Riora OS: customer_action_logs の action_type 制約を拡張
-- 実行: Supabase Dashboard > SQL Editor に貼り付けて Run
--
-- 背景:
--   既存の CHECK 制約は 5 値のみ許可しており
--   CSV取込・NextAction記録・接客ログが全て INSERT エラーで失敗する。
--   本 migration で全 action_type を正式に許可する。
--
-- 冪等: DROP CONSTRAINT IF EXISTS → ADD CONSTRAINT の順で安全
-- ================================================================

-- 既存の制約を削除
ALTER TABLE public.customer_action_logs
  DROP CONSTRAINT IF EXISTS chk_action_type;

-- 拡張した制約を追加
ALTER TABLE public.customer_action_logs
  ADD CONSTRAINT chk_action_type CHECK (
    action_type IN (
      -- 既存（接客ログ）
      'line_sent',
      'homecare_explained',
      'rebook_recommended',
      'product_recommended',
      'product_purchased',
      -- 追加（CSV取込）
      'csv_import',
      -- 追加（NextAction ルール）
      'next_action_inactive',
      'next_action_line',
      'next_action_rebook',
      'next_action_product',
      'next_action_vip',
      'next_action_homecare',
      -- 追加（接客ログ追加項目）
      'option_sold',
      'retail_sold',
      'churn_followed'
    )
  );

-- 確認用クエリ（実行後に制約の内容を確認できる）
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'public.customer_action_logs'::regclass
-- AND contype = 'c';
