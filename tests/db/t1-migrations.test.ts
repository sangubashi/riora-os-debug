// ================================================================
// Riora Brain Phase1 - Step1: T1テスト (T1-1〜T1-6)
//
// 実装タスク分解書v1 1-C のT1テスト表に対応する。
// pglite (WASM Postgres) 上にsupabase/migrations/2026061200000{1-7}_*.sql
// を適用し、migration適用・RLS・CHECK制約・シードデータを検証する。
// ================================================================

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import jsonLogic from 'json-logic-js';
import { applyMigrations, createTestDb } from './setup';

const STORE_A = '00000000-0000-0000-0000-000000000001'; // 新富店 (seed_master.sql)
const STORE_B = '11111111-1111-1111-1111-111111111111'; // RLS他店データ不可視テスト用

// PatternContext (snake_case変換後) のサンプル値。
// fire_condition/entry_condition が参照する全変数を網羅する2パターン。
const SAMPLE_CONTEXTS: Record<string, unknown>[] = [
  {
    visit_count: 4,
    homecare_purchased_ever: false,
    homecare_declined_recent: false,
    skin_improved: true,
    skin_stagnant2: false,
    subsc_conditions_met: 4,
    churn_score: 0.2,
    next_booking_made_last: true,
    is_nomination_streak2: true,
    wedding_days_left: null,
  },
  {
    visit_count: 1,
    homecare_purchased_ever: true,
    homecare_declined_recent: true,
    skin_improved: false,
    skin_stagnant2: true,
    subsc_conditions_met: 0,
    churn_score: 0.8,
    next_booking_made_last: false,
    is_nomination_streak2: false,
    wedding_days_left: 45,
  },
];

describe('T1-1: migration全適用→ロールバック→再適用', () => {
  it('全migrationを2回適用してもエラーにならず、シードが重複しない(冪等)', async () => {
    const db = await createTestDb();
    await applyMigrations(db);
    await applyMigrations(db); // 再適用

    const stores = await db.query('SELECT id FROM brain_stores');
    expect(stores.rows.length).toBe(1);

    const patterns = await db.query('SELECT id FROM brain_success_patterns');
    expect(patterns.rows.length).toBe(8);

    const steps = await db.query('SELECT id FROM brain_pattern_steps');
    expect(steps.rows.length).toBe(28);

    await db.close();
  });

  it('新規DB(ロールバック後相当の空状態)への適用が成功する', async () => {
    const db = await createTestDb();
    await applyMigrations(db);

    const stores = await db.query('SELECT id FROM brain_stores');
    expect(stores.rows.length).toBe(1);

    await db.close();
  });
});

describe('Step1 migration適用後の検証 (T1-2〜T1-6)', () => {
  let db: PGlite;
  let customerId: string;
  let visitId: string;

  beforeAll(async () => {
    db = await createTestDb();
    await applyMigrations(db);

    // T1-3 (RLS他店データ不可視) 用に第2店舗を用意する。
    await db.query('INSERT INTO brain_stores (id, name) VALUES ($1, $2)', [STORE_B, 'テスト2号店']);
    await db.query(
      `INSERT INTO brain_staff (store_id, name, style) VALUES ($1, 'テストスタッフ', 'evidence')`,
      [STORE_B]
    );

    // T1-4 (CHECK制約) 用に有効な顧客・来店記録を用意する (STORE_A)。
    const custRes = await db.query<{ id: string }>(
      `INSERT INTO brain_customers (store_id, name, customer_type, churn_score)
       VALUES ($1, 'テスト客', 'A_acne', 0.1) RETURNING id`,
      [STORE_A]
    );
    customerId = custRes.rows[0].id;

    const staffRes = await db.query<{ id: string }>(
      'SELECT id FROM brain_staff WHERE store_id = $1 LIMIT 1',
      [STORE_A]
    );
    const menuRes = await db.query<{ id: string }>(
      'SELECT id FROM brain_menus WHERE store_id = $1 LIMIT 1',
      [STORE_A]
    );

    const visitRes = await db.query<{ id: string }>(
      `INSERT INTO brain_visits (store_id, customer_id, staff_id, menu_id, visit_date, visit_count_at)
       VALUES ($1, $2, $3, $4, '2026-06-01', 1) RETURNING id`,
      [STORE_A, customerId, staffRes.rows[0].id, menuRes.rows[0].id]
    );
    visitId = visitRes.rows[0].id;
  });

  afterAll(async () => {
    await db.close();
  });

  describe('T1-2: 既存スキーマへの非干渉', () => {
    it('新規migrationが作成するテーブルは全てbrain_接頭辞を持つ', async () => {
      const res = await db.query<{ tablename: string }>(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
      );
      const nonBrainTables = res.rows.map((r) => r.tablename).filter((t) => !t.startsWith('brain_'));
      expect(nonBrainTables).toEqual([]);
    });
  });

  describe('T1-3: RLS検証', () => {
    it('app.store_id未設定のセッションでは店舗系テーブルが0件', async () => {
      const rows = await db.transaction(async (tx) => {
        await tx.query('SET LOCAL ROLE authenticated');
        const res = await tx.query('SELECT * FROM brain_staff');
        return res.rows;
      });

      expect(rows.length).toBe(0);
    });

    it('app.store_idを設定すると自店データのみ可視', async () => {
      const rows = await db.transaction(async (tx) => {
        await tx.query('SET LOCAL ROLE authenticated');
        await tx.query(`SET LOCAL app.store_id = '${STORE_A}'`);
        const res = await tx.query<{ store_id: string }>('SELECT store_id FROM brain_staff');
        return res.rows;
      });

      expect(rows.length).toBe(3);
      expect(rows.every((r) => r.store_id === STORE_A)).toBe(true);
    });

    it('別store_idを設定すると他店データは不可視', async () => {
      const rows = await db.transaction(async (tx) => {
        await tx.query('SET LOCAL ROLE authenticated');
        await tx.query(`SET LOCAL app.store_id = '${STORE_B}'`);
        const res = await tx.query<{ store_id: string }>('SELECT store_id FROM brain_staff');
        return res.rows;
      });

      expect(rows.length).toBe(1);
      expect(rows[0].store_id).toBe(STORE_B);
    });
  });

  describe('T1-4: CHECK制約', () => {
    it('customer_typeに不正な値はINSERTできない', async () => {
      await expect(
        db.query(
          `INSERT INTO brain_customers (store_id, name, customer_type) VALUES ($1, 'NG', 'X_invalid')`,
          [STORE_A]
        )
      ).rejects.toThrow();
    });

    it('skin_records.acne_level=6はINSERTできない', async () => {
      await expect(
        db.query(`INSERT INTO brain_skin_records (customer_id, visit_id, acne_level) VALUES ($1, $2, 6)`, [
          customerId,
          visitId,
        ])
      ).rejects.toThrow();
    });

    it('churn_score=1.5はINSERTできない', async () => {
      await expect(
        db.query(`INSERT INTO brain_customers (store_id, name, churn_score) VALUES ($1, 'NG', 1.5)`, [STORE_A])
      ).rejects.toThrow();
    });
  });

  describe('T1-5: シード検証 (json-logic-jsパース)', () => {
    it('8パターン全ての entry_condition がパース可能', async () => {
      const res = await db.query<{ id: string; entry_condition: any }>(
        'SELECT id, entry_condition FROM brain_success_patterns ORDER BY id'
      );

      expect(res.rows.map((r) => r.id)).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'D1', 'D2', 'E1']);

      for (const row of res.rows) {
        for (const ctx of SAMPLE_CONTEXTS) {
          const result = jsonLogic.apply(row.entry_condition, ctx);
          expect(typeof result).toBe('boolean');
        }
      }
    });

    it('全パターン全stepの fire_condition がパース可能', async () => {
      const res = await db.query<{ pattern_id: string; step_no: number; fire_condition: any }>(
        'SELECT pattern_id, step_no, fire_condition FROM brain_pattern_steps ORDER BY pattern_id, step_no'
      );

      expect(res.rows.length).toBe(28);

      for (const row of res.rows) {
        for (const ctx of SAMPLE_CONTEXTS) {
          const result = jsonLogic.apply(row.fire_condition, ctx);
          expect(typeof result).toBe('boolean');
        }
      }
    });
  });

  describe('T1-6: brain_eventsの冪等キー', () => {
    it('同一(store_anon_id, customer_hash, event_type, occurred_on, visit_count_at)の2回目INSERTはconflictする', async () => {
      const event = {
        storeAnonId: '99999999-9999-9999-9999-999999999999',
        customerHash: 'testhash123',
        eventType: 'visit',
        occurredOn: '2026-06-01',
        visitCountAt: 1,
      };

      await db.query(
        `INSERT INTO brain_events (store_anon_id, customer_hash, event_type, occurred_on, visit_count_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [event.storeAnonId, event.customerHash, event.eventType, event.occurredOn, event.visitCountAt]
      );

      await expect(
        db.query(
          `INSERT INTO brain_events (store_anon_id, customer_hash, event_type, occurred_on, visit_count_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [event.storeAnonId, event.customerHash, event.eventType, event.occurredOn, event.visitCountAt]
        )
      ).rejects.toThrow();
    });
  });
});
