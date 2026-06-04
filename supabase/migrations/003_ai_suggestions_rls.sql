-- ============================================================
-- Migration: ai_suggestions に認証済みユーザーの読み取りを許可
-- system_analysis が挿入した提案をスタッフが参照できるようにする
-- ============================================================

-- 既存の制限的なポリシーを一旦削除
drop policy if exists "staff_own_suggestions"              on ai_suggestions;
drop policy if exists "manager_owner_read_all_suggestions" on ai_suggestions;

-- 認証済みユーザーは全 AI 提案を読み取り可（PII なしデータのため）
create policy "authenticated_read_ai_suggestions" on ai_suggestions
  for select
  using (auth.role() = 'authenticated');

-- システムによる INSERT（service role 経由）は引き続き許可
-- ※ service role は RLS をバイパスするため追加ポリシー不要

-- スタッフは自分が挿入したレコードのみ更新・削除可
create policy "staff_own_write_suggestions" on ai_suggestions
  for insert
  with check (
    staff_id = (select staff_id from profiles where id = auth.uid())
    or staff_id = 'system_analysis'
  );
