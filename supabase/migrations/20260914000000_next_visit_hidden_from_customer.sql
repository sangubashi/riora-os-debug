-- お客様用カルテ再構成(2026-09-14): 「次回のお手入れ目安」を顧客ごとにお客様モードで
-- 非表示にできる設定列を1つだけ追加する。NOT NULL・デフォルトfalseのため、
-- 既存データは全件「表示する」のまま変わらない(挙動に影響なし)。
-- スタッフ側(CustomerBottomSheet/IpadStaffKarteView)の表示には影響しない
-- (お客様モード=CustomerModeView.tsxの表示のみを制御する設定)。

ALTER TABLE public.brain_customers
  ADD COLUMN IF NOT EXISTS next_visit_hidden_from_customer boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.brain_customers.next_visit_hidden_from_customer IS
  'お客様モード(CustomerModeView.tsx)で「次回のお手入れ目安」を非表示にするかどうか。担当スタッフがiPadカルテから切り替える。スタッフ向け画面の表示には影響しない。';
