// ================================================================
// Riora Brain Phase2 - Step1: W8migration (20260612000008) 検証
//
// Success Pattern Final Architecture v1.0 5章のDBスキーマ差分
// (列追加5テーブル / brain_pattern_fire_log新設 / brain_pattern_step_stats
//  マテビュー / brain_paramsシード) を検証する。店内提案(in_store)のみ。
// ================================================================

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { applyMigrations, createTestDb } from './setup';

const STORE_A = '00000000-0000-0000-0000-000000000001'; // 新富町店 (seed_master.sql)
const STORE_B = '22222222-2222-2222-2222-222222222222';

describe('W8 migration (20260612000008) 検証', () => {
  let db: PGlite;
  let customerId: string;
  let staffId: string;
  let visitId: string;

  beforeAll(async () => {
    db = await createTestDb();
    await applyMigrations(db);

    const custRes = await db.query<{ id: string }>(
      `INSERT INTO brain_customers (store_id, name, customer_type, churn_score)
       VALUES ($1, 'W8テスト客', 'B_pore', 0.1) RETURNING id`,
      [STORE_A]
    );
    customerId = custRes.rows[0].id;

    const staffRes = await db.query<{ id: string }>('SELECT id FROM brain_staff WHERE store_id = $1 LIMIT 1', [
      STORE_A,
    ]);
    staffId = staffRes.rows[0].id;

    const menuRes = await db.query<{ id: string }>('SELECT id FROM brain_menus WHERE store_id = $1 LIMIT 1', [
      STORE_A,
    ]);

    const visitRes = await db.query<{ id: string }>(
      `INSERT INTO brain_visits (store_id, customer_id, staff_id, menu_id, visit_date, visit_count_at)
       VALUES ($1, $2, $3, $4, '2026-06-12', 1) RETURNING id`,
      [STORE_A, customerId, staffId, menuRes.rows[0].id]
    );
    visitId = visitRes.rows[0].id;
  });

  afterAll(async () => {
    await db.close();
  });

  describe('1. brain_success_patterns.lifecycle_status / lifecycle_changed_at', () => {
    it('既存8パターンは全てDEFAULT active・lifecycle_changed_atはNULL', async () => {
      const res = await db.query<{ id: string; lifecycle_status: string; lifecycle_changed_at: string | null }>(
        'SELECT id, lifecycle_status, lifecycle_changed_at FROM brain_success_patterns ORDER BY id'
      );
      expect(res.rows.length).toBe(8);
      for (const row of res.rows) {
        expect(row.lifecycle_status).toBe('active');
        expect(row.lifecycle_changed_at).toBeNull();
      }
    });

    it('CHECK制約: lifecycle_statusは6状態以外を許可しない', async () => {
      await expect(
        db.query(
          `UPDATE brain_success_patterns SET lifecycle_status = 'invalid_state' WHERE id = 'B1'`
        )
      ).rejects.toThrow();
    });
  });

  describe('2. brain_pattern_steps.soft_features / optimal_visit', () => {
    it('全28stepにsoft_features.weightsとoptimal_visitが設定される', async () => {
      const res = await db.query<{ pattern_id: string; step_no: number; optimal_visit: number; soft_features: any }>(
        'SELECT pattern_id, step_no, optimal_visit, soft_features FROM brain_pattern_steps ORDER BY pattern_id, step_no'
      );
      expect(res.rows.length).toBe(28);
      for (const row of res.rows) {
        expect(row.optimal_visit).not.toBeNull();
        expect(row.soft_features?.weights).toBeDefined();
        expect(row.soft_features.weights.cycle_position).toBeCloseTo(0.2);
      }
    });

    it('optimal_visitはfire_conditionのvisit_count閾値と一致する(A1/E1)', async () => {
      const a1 = await db.query<{ step_no: number; optimal_visit: number }>(
        `SELECT step_no, optimal_visit FROM brain_pattern_steps WHERE pattern_id = 'A1' ORDER BY step_no`
      );
      expect(a1.rows.map((r) => r.optimal_visit)).toEqual([1, 2, 3, 4]);

      const e1 = await db.query<{ step_no: number; optimal_visit: number }>(
        `SELECT step_no, optimal_visit FROM brain_pattern_steps WHERE pattern_id = 'E1' ORDER BY step_no`
      );
      expect(e1.rows.map((r) => r.optimal_visit)).toEqual([1, 2, 3]);
    });
  });

  describe('3. brain_pattern_progress.assign_score / switch_candidate / switch_streak', () => {
    it('switch_streakはデフォルト0、assign_score/switch_candidateはNULL許容', async () => {
      await db.query(`INSERT INTO brain_pattern_progress (customer_id, pattern_id) VALUES ($1, 'B1')`, [customerId]);

      const res = await db.query<{ assign_score: string | null; switch_candidate: string | null; switch_streak: number }>(
        'SELECT assign_score, switch_candidate, switch_streak FROM brain_pattern_progress WHERE customer_id = $1',
        [customerId]
      );
      expect(res.rows[0].assign_score).toBeNull();
      expect(res.rows[0].switch_candidate).toBeNull();
      expect(res.rows[0].switch_streak).toBe(0);
    });

    it('assign_score/switch_candidate/switch_streakを更新できる(ヒステリシス用)', async () => {
      await db.query(
        `UPDATE brain_pattern_progress SET assign_score = 0.42, switch_candidate = 'B2', switch_streak = 1
         WHERE customer_id = $1`,
        [customerId]
      );
      const res = await db.query<{ assign_score: string; switch_candidate: string; switch_streak: number }>(
        'SELECT assign_score, switch_candidate, switch_streak FROM brain_pattern_progress WHERE customer_id = $1',
        [customerId]
      );
      expect(Number(res.rows[0].assign_score)).toBeCloseTo(0.42);
      expect(res.rows[0].switch_candidate).toBe('B2');
      expect(res.rows[0].switch_streak).toBe(1);
    });
  });

  describe('4. brain_proposal_outcomes.fire_score / decisive_factor', () => {
    it('fire_score/decisive_factorを保存できる', async () => {
      const res = await db.query<{ id: string }>(
        `INSERT INTO brain_proposal_outcomes
           (store_id, customer_id, visit_id, staff_id, pattern_id, step_no, proposal_kind, visit_count_at,
            was_briefed, was_executed, was_accepted, customer_type, staff_style, fire_score, decisive_factor)
         VALUES ($1,$2,$3,$4,'B1',2,'homecare',1,true,true,true,'B_pore','evidence',78.5,'successRate')
         RETURNING id`,
        [STORE_A, customerId, visitId, staffId]
      );

      const row = await db.query<{ fire_score: string; decisive_factor: string }>(
        'SELECT fire_score, decisive_factor FROM brain_proposal_outcomes WHERE id = $1',
        [res.rows[0].id]
      );
      expect(Number(row.rows[0].fire_score)).toBeCloseTo(78.5);
      expect(row.rows[0].decisive_factor).toBe('successRate');
    });
  });

  describe('5. brain_staff_adjustments.affinity_score', () => {
    it('CHECK制約: 0-1の範囲外はINSERT/UPDATEできない', async () => {
      await expect(
        db.query(
          `INSERT INTO brain_staff_adjustments (staff_id, pattern_id, proposal_kind, affinity_score)
           VALUES ($1, 'B1', 'homecare', 1.5)
           ON CONFLICT (staff_id, pattern_id, proposal_kind) DO UPDATE SET affinity_score = EXCLUDED.affinity_score`,
          [staffId]
        )
      ).rejects.toThrow();
    });

    it('0-1の範囲内は保存できる', async () => {
      await db.query(
        `INSERT INTO brain_staff_adjustments (staff_id, pattern_id, proposal_kind, affinity_score)
         VALUES ($1, 'B1', 'homecare', 0.73)
         ON CONFLICT (staff_id, pattern_id, proposal_kind) DO UPDATE SET affinity_score = EXCLUDED.affinity_score`,
        [staffId]
      );
      const res = await db.query<{ affinity_score: string }>(
        `SELECT affinity_score FROM brain_staff_adjustments WHERE staff_id = $1 AND pattern_id = 'B1' AND proposal_kind = 'homecare'`,
        [staffId]
      );
      expect(Number(res.rows[0].affinity_score)).toBeCloseTo(0.73);
    });
  });

  describe('6. brain_pattern_fire_log (新設テーブル + RLS)', () => {
    it('DecisionRecord(JSONB)と説明文を保存できる', async () => {
      const decisionRecord = { winner: 'B1-step2', candidates: [], stageReached: 3 };
      const res = await db.query<{ id: string }>(
        `INSERT INTO brain_pattern_fire_log (store_id, customer_id, visit_id, decision_record, explanation)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [STORE_A, customerId, visitId, JSON.stringify(decisionRecord), 'B1-step2を提案しました']
      );
      expect(res.rows[0].id).toBeTruthy();

      const row = await db.query<{ decision_record: any; explanation: string }>(
        'SELECT decision_record, explanation FROM brain_pattern_fire_log WHERE id = $1',
        [res.rows[0].id]
      );
      expect(row.rows[0].decision_record.winner).toBe('B1-step2');
      expect(row.rows[0].explanation).toBe('B1-step2を提案しました');
    });

    it('RLS: app.store_idが自店なら参照可、他店/未設定なら0件', async () => {
      const ownRows = await db.transaction(async (tx) => {
        await tx.query('SET LOCAL ROLE authenticated');
        await tx.query(`SET LOCAL app.store_id = '${STORE_A}'`);
        const r = await tx.query('SELECT id FROM brain_pattern_fire_log');
        return r.rows;
      });
      expect(ownRows.length).toBe(1);

      const otherRows = await db.transaction(async (tx) => {
        await tx.query('SET LOCAL ROLE authenticated');
        await tx.query(`SET LOCAL app.store_id = '${STORE_B}'`);
        const r = await tx.query('SELECT id FROM brain_pattern_fire_log');
        return r.rows;
      });
      expect(otherRows.length).toBe(0);

      const unsetRows = await db.transaction(async (tx) => {
        await tx.query('SET LOCAL ROLE authenticated');
        const r = await tx.query('SELECT id FROM brain_pattern_fire_log');
        return r.rows;
      });
      expect(unsetRows.length).toBe(0);
    });
  });

  describe('7. brain_pattern_step_stats (マテリアライズドビュー)', () => {
    it('REFRESH後、was_executed=trueの行のみセル粒度で集計される', async () => {
      const rows: Array<{ accepted: boolean; fireScore: number; executed: boolean }> = [
        { accepted: true, fireScore: 80, executed: true },
        { accepted: true, fireScore: 90, executed: true },
        { accepted: false, fireScore: 70, executed: true },
        { accepted: false, fireScore: 0, executed: false },
      ];

      for (const r of rows) {
        await db.query(
          `INSERT INTO brain_proposal_outcomes
             (store_id, customer_id, visit_id, staff_id, pattern_id, step_no, proposal_kind, visit_count_at,
              was_briefed, was_executed, was_accepted, customer_type, staff_style, fire_score)
           VALUES ($1,$2,$3,$4,'C1',99,'homecare',1,true,$5,$6,'C_sensitive','theory',$7)`,
          [STORE_A, customerId, visitId, staffId, r.executed, r.accepted, r.fireScore]
        );
      }

      await db.query('REFRESH MATERIALIZED VIEW brain_pattern_step_stats');

      const res = await db.query<{
        candidate_code: string;
        executed_n: number;
        accepted_n: number;
        laplace_rate: string;
        repeat_rate_90d: string | null;
        avg_fire_score: string;
      }>(
        `SELECT candidate_code, executed_n, accepted_n, laplace_rate, repeat_rate_90d, avg_fire_score
         FROM brain_pattern_step_stats
         WHERE candidate_code = 'C1-step99' AND customer_type = 'C_sensitive' AND staff_style = 'theory'`
      );

      expect(res.rows.length).toBe(1);
      const row = res.rows[0];
      expect(row.executed_n).toBe(3);
      expect(row.accepted_n).toBe(2);
      expect(Number(row.laplace_rate)).toBeCloseTo((2 + 1) / (3 + 3));
      expect(row.repeat_rate_90d).toBeNull();
      expect(Number(row.avg_fire_score)).toBeCloseTo((80 + 90 + 70) / 3);
    });
  });

  describe('8. brain_params シード (fire_score_weights / style_affinity / lifecycle_thresholds)', () => {
    it('cluster=office_area, version=1で3キーがシードされる', async () => {
      const res = await db.query<{ key: string; value: any }>(
        `SELECT key, value FROM brain_params WHERE cluster = 'office_area' AND version = 1 ORDER BY key`
      );
      expect(res.rows.map((r) => r.key)).toEqual(['fire_score_weights', 'lifecycle_thresholds', 'style_affinity']);

      const weights = res.rows.find((r) => r.key === 'fire_score_weights')!.value;
      expect(weights).toEqual({ w1: 0.3, w2: 0.2, w3: 0.2, w4: 0.15, w5: 0.15 });
      const sum = weights.w1 + weights.w2 + weights.w3 + weights.w4 + weights.w5;
      expect(sum).toBeCloseTo(1);

      const styleAffinity = res.rows.find((r) => r.key === 'style_affinity')!.value;
      expect(Object.keys(styleAffinity).sort()).toEqual(['empathy', 'evidence', 'theory']);
      expect(styleAffinity.evidence.homecare).toBe(0.5);

      const lifecycleThresholds = res.rows.find((r) => r.key === 'lifecycle_thresholds')!.value;
      expect(Object.keys(lifecycleThresholds).sort()).toEqual([
        'demotion',
        'promotion',
        'suspension',
        'watchDemotion',
        'watchRecovery',
      ]);
    });
  });

  describe('9. T1-2非干渉(brain_接頭辞)との整合', () => {
    it('新設テーブルは全てbrain_接頭辞を持つ', async () => {
      const res = await db.query<{ tablename: string }>(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
      );
      const nonBrainTables = res.rows.map((r) => r.tablename).filter((t) => !t.startsWith('brain_'));
      expect(nonBrainTables).toEqual([]);
    });
  });
});
