-- 次回目安エンジン(2026-09-11): 担当スタッフによる手動上書き用の列を1つだけ追加する。
-- NULL許容・デフォルト値なしのため、既存データへの影響・テーブル書き換えは発生しない。
-- 適用済み(Supabase Dashboard経由): 2026-09-11

ALTER TABLE public.brain_customers
  ADD COLUMN IF NOT EXISTS next_visit_override_date date;

COMMENT ON COLUMN public.brain_customers.next_visit_override_date IS
  '次回目安エンジン(2026-09-11)の手動上書き。担当スタッフが設定した場合、自動算出より優先して全画面に表示する。';
