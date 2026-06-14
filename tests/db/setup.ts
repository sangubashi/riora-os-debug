// ================================================================
// Riora Brain Phase1 - Step1: T1テスト用 pgliteセットアップ
//
// pglite (WASM Postgres) 上に Supabase相当のロール (anon/authenticated/
// service_role) を作成し、supabase/migrations/2026061200000{1-7}_*.sql
// を順番に適用するヘルパー。
// ================================================================

import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../supabase/migrations');

// 実装順厳守: Step1 (1-A) で追加された7ファイル + Pattern Engine W8 (000008) をこの順で適用する。
export const BRAIN_MIGRATION_FILES = [
  '20260612000001_core_tables.sql',
  '20260612000002_pattern_tables.sql',
  '20260612000003_learning_tables.sql',
  '20260612000004_brain_tables.sql',
  '20260612000005_rls_policies.sql',
  '20260612000006_seed_master.sql',
  '20260612000007_seed_patterns.sql',
  '20260612000008_w8_pattern_engine.sql',
  '20260612000009_brain_scenarios.sql',
] as const;

export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite();
  // SupabaseプラットフォームのGRANT/RLSポリシーが参照するロールを再現する。
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
  `);
  return db;
}

export async function applyMigrations(db: PGlite): Promise<void> {
  for (const file of BRAIN_MIGRATION_FILES) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    await db.exec(sql);
  }
}
