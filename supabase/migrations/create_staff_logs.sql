-- ============================================================
-- Migration: staff_logs を施術セッション記録用に再構築
-- 既存テーブル・ポリシーを削除してから再作成する
-- CAUTION: 既存の staff_logs データは削除されます
-- ============================================================

-- 既存ポリシーを削除（存在しない場合は無視）
drop policy if exists "manager_owner_read_staff_logs" on staff_logs;
drop policy if exists "staff_own_logs"                on staff_logs;
drop policy if exists "manager_owner_view_all"         on staff_logs;

-- 既存テーブルを削除（他テーブルからの FK があれば CASCADE）
drop table if exists staff_logs cascade;

-- ============================================================
-- 新テーブル: 施術セッション記録
-- ============================================================
create table staff_logs (
  id               uuid primary key default gen_random_uuid(),
  reservation_id   uuid references reservations(id)  on delete set null,
  customer_id      uuid references customers(id)      on delete set null,
  staff_id         uuid references auth.users(id)     on delete set null,
  ai_adopted       boolean not null default false,
  next_reserved    boolean not null default false,
  option_sold      boolean not null default false,
  retail_sold      boolean not null default false,
  churn_followed   boolean not null default false,
  created_at       timestamptz not null default now()
);

-- ============================================================
-- RLS
-- ============================================================
alter table staff_logs enable row level security;

-- スタッフは自分のログのみ INSERT / SELECT 可
create policy "staff_own_logs" on staff_logs
  for all
  using     (staff_id = auth.uid())
  with check (staff_id = auth.uid());

-- manager / owner は全件閲覧可
create policy "manager_owner_view_all" on staff_logs
  for select
  using (
    exists (
      select 1 from profiles
      where id = auth.uid()
        and role in ('manager', 'owner')
    )
  );
