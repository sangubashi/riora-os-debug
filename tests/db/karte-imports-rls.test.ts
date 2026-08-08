// ================================================================
// karte_imports GRANT/RLS 検証 (KARTE-IMPORT-SEC-1)
//
// 監査: docs/security/KARTE_IMPORTS_RLS_SECURITY_AUDIT.md 案C
// 対象migration:
//   supabase/migrations/20260807010000_karte_import.sql (元のテーブル作成)
//   supabase/migrations/20260808000000_karte_imports_service_role_only.sql (本セキュリティ是正)
//
// pglite(WASM Postgres)上に anon/authenticated/service_role ロールと
// karte_imports が依存する最小限のスタブテーブル(auth.users / public.customers /
// public.customer_notes)を用意し、2つの実migrationファイルをそのまま適用したうえで、
// SET LOCAL ROLE で実際のPostgreSQL権限システムを通してGRANT/RLSの挙動を検証する。
// (tests/db/t1-migrations.test.ts の T1-3 と同一のロール切り替えパターンを踏襲)
// ================================================================

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../supabase/migrations');

const KARTE_IMPORT_MIGRATIONS = [
  '20260807010000_karte_import.sql',
  '20260808000000_karte_imports_service_role_only.sql',
] as const;

async function createStubDb(): Promise<PGlite> {
  const db = new PGlite();

  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;

    -- Supabaseの auth.users 相当のスタブ(karte_imports.staff_id のFK先)
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid());

    -- 001_schema.sql の customers テーブル相当のスタブ(karte_imports.customer_id のFK先)。
    -- GRANT/RLSの検証が目的のため、FKを満たす最小列のみ用意する。
    CREATE TABLE public.customers (id uuid PRIMARY KEY DEFAULT gen_random_uuid());

    -- karte_import.sql の DO ブロックが ALTER TABLE ADD CONSTRAINT する対象。
    -- 20260616_customer_notes_ai.sql 相当のsourceカラムのみ最小再現する。
    CREATE TABLE public.customer_notes (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_id uuid REFERENCES public.customers(id),
      staff_id    uuid,
      note        text,
      category    text,
      source      text NOT NULL DEFAULT 'manual' CHECK (source IN ('voice_note', 'manual'))
    );
  `);

  return db;
}

async function applyKarteImportMigrations(db: PGlite): Promise<void> {
  for (const file of KARTE_IMPORT_MIGRATIONS) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    await db.exec(sql);
  }
}

describe('karte_imports: 20260808000000 適用後のGRANT/RLS', () => {
  let db: PGlite;
  let customerId: string;

  beforeAll(async () => {
    db = await createStubDb();
    await applyKarteImportMigrations(db);

    const custRes = await db.query<{ id: string }>(
      `INSERT INTO public.customers DEFAULT VALUES RETURNING id`
    );
    customerId = custRes.rows[0].id;
  });

  afterAll(async () => {
    await db.close();
  });

  it('migrationを2回適用してもエラーにならない(冪等性)', async () => {
    await expect(applyKarteImportMigrations(db)).resolves.not.toThrow();
  });

  it('authenticated は karte_imports を SELECT できない(permission denied)', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.query('SET LOCAL ROLE authenticated');
        await tx.query('SELECT * FROM public.karte_imports');
      })
    ).rejects.toThrow(/permission denied/i);
  });

  it('authenticated は karte_imports に INSERT できない(permission denied)', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.query('SET LOCAL ROLE authenticated');
        await tx.query(
          `INSERT INTO public.karte_imports (customer_id, staff_id, raw_text)
           VALUES ($1, NULL, 'カルテ原文')`,
          [customerId]
        );
      })
    ).rejects.toThrow(/permission denied/i);
  });

  it('service_role は karte_imports に INSERT できる', async () => {
    const inserted = await db.transaction(async (tx) => {
      await tx.query('SET LOCAL ROLE service_role');
      const res = await tx.query<{ id: string }>(
        `INSERT INTO public.karte_imports (customer_id, staff_id, raw_text)
         VALUES ($1, NULL, 'カルテ原文') RETURNING id`,
        [customerId]
      );
      return res.rows[0].id;
    });

    expect(inserted).toBeTruthy();
  });

  it('service_role は karte_imports を SELECT できる', async () => {
    const rows = await db.transaction(async (tx) => {
      await tx.query('SET LOCAL ROLE service_role');
      const res = await tx.query('SELECT * FROM public.karte_imports WHERE customer_id = $1', [customerId]);
      return res.rows;
    });

    expect(rows.length).toBeGreaterThan(0);
  });

  it('テーブルレベルGRANT: authenticatedにはSELECT/INSERTが付与されていない', async () => {
    const res = await db.query<{ grantee: string; privilege_type: string }>(
      `SELECT grantee, privilege_type
       FROM information_schema.role_table_grants
       WHERE table_schema = 'public' AND table_name = 'karte_imports'
         AND grantee = 'authenticated'`
    );
    expect(res.rows).toEqual([]);
  });

  it('テーブルレベルGRANT: service_roleにはSELECT/INSERTが付与されている', async () => {
    const res = await db.query<{ privilege_type: string }>(
      `SELECT privilege_type
       FROM information_schema.role_table_grants
       WHERE table_schema = 'public' AND table_name = 'karte_imports'
         AND grantee = 'service_role'
       ORDER BY privilege_type`
    );
    expect(res.rows.map((r) => r.privilege_type)).toEqual(['INSERT', 'SELECT']);
  });

  it('RLSポリシー: ki_select/ki_insertともroles=service_roleのみ', async () => {
    const res = await db.query<{ policyname: string; roles: string[] }>(
      `SELECT policyname, roles
       FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'karte_imports'
       ORDER BY policyname`
    );

    expect(res.rows).toEqual([
      { policyname: 'ki_insert', roles: ['service_role'] },
      { policyname: 'ki_select', roles: ['service_role'] },
    ]);
  });

  it('RLSは有効なまま(relrowsecurity=true)', async () => {
    const res = await db.query<{ relrowsecurity: boolean }>(
      `SELECT relrowsecurity FROM pg_class WHERE oid = 'public.karte_imports'::regclass`
    );
    expect(res.rows[0].relrowsecurity).toBe(true);
  });
});
