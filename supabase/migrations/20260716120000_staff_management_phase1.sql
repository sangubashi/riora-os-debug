-- ================================================================
-- STAFF_MANAGEMENT_PHASE1_IMPLEMENT_1 (2026-07-16)
--
-- 目的: スタッフ管理Phase1（退職処理・is_active反映・admin流用防止）に伴う
-- スキーマ整備。
--
-- 背景: brain_staff.user_id 列は既に本番に存在するが、どのマイグレーション
-- ファイルにも定義がない「未記録の変更」であることがSTAFF_MANAGEMENT_DESIGN_1/
-- STAFF_MANAGEMENT_IMPLEMENT_PLAN_1の調査で判明した。本マイグレーションでは
-- 実スキーマを追認するコメントと、事故防止のためのUNIQUE制約のみを追加する。
--
-- 注意: このファイルはSTAFF_MANAGEMENT_PHASE1_IMPLEMENT_1の一部として作成した
-- ものであり、本番Supabaseへの適用（実行）はこのセッションでは行っていない。
-- 適用にはユーザー側で `supabase db push` 等の実行が別途必要。
-- ================================================================

-- brain_staff.user_id: auth.users.id を保持し、extractStaffFromRequest() が
-- JWTユーザーからスタッフを解決する際の主キー。列自体は既存だが、これまで
-- マイグレーション履歴に記録されていなかったため、ここで追認する。
COMMENT ON COLUMN public.brain_staff.user_id IS
  'auth.users.id への参照(FK制約なし)。extractStaffFromRequest()がJWTユーザーから'
  'brain_staff行を解決する際に使用する。1つのauth.usersアカウントは1つのbrain_staff'
  '行のみに紐付くこと(UNIQUE制約参照)。';

-- 1つのauth.usersアカウントが複数のbrain_staff人格を持てないようにする。
-- NULLは複数行で許容される(UNIQUE制約はNULL同士を区別するPostgreSQLの標準挙動)。
ALTER TABLE public.brain_staff
  ADD CONSTRAINT brain_staff_user_id_unique UNIQUE (user_id);
