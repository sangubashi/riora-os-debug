-- Add service_completed column to staff_logs
alter table staff_logs
  add column if not exists service_completed boolean not null default false;
