// ================================================================
// ReservationRepo — 当日キャンセル機能(2026-10-01)のキャンセル追跡カラム対応
//
//  - CSV取込(create/update)でcancelledになる行は cancel_source='salonboard_csv'(cancelled_atは触らない)
//  - cancelled以外へ更新する行は cancel_source / cancelled_at をNULLへ戻す
//  - findByNaturalKeyは cancel_source を返し、同一キーの重複行に手動キャンセル済みがあればそれを優先する
// ================================================================
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ReservationRepo } from '../../../src/repositories/supabase/ReservationRepo';
import type { ReservationUpsertInput } from '../../../src/repositories/interfaces';

const INPUT: ReservationUpsertInput = {
  staffId: 'staff-1', brainCustomerId: 'cust-1', menu: '毛穴ケア', price: 5000,
  scheduledAt: '2026-10-01T01:00:00.000Z', durationMinutes: 60,
  status: 'confirmed', isNewCustomer: false, notes: null,
};

/** insert/update のペイロードを記録するフェイク。 */
function createWriteFake() {
  const calls: { op: 'insert' | 'update'; payload: Record<string, unknown> }[] = [];
  const client = {
    from: vi.fn(() => ({
      insert: (payload: Record<string, unknown>) => {
        calls.push({ op: 'insert', payload });
        return { select: () => ({ single: async () => ({ data: { id: 'new-1' }, error: null }) }) };
      },
      update: (payload: Record<string, unknown>) => {
        calls.push({ op: 'update', payload });
        return { eq: async () => ({ error: null }) };
      },
    })),
  };
  return { calls, repo: new ReservationRepo(client as unknown as SupabaseClient) };
}

function createSelectFake(rows: unknown[]) {
  const client = {
    from: vi.fn(() => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.is = () => chain;
      chain.order = async () => ({ data: rows, error: null });
      return chain;
    }),
  };
  return new ReservationRepo(client as unknown as SupabaseClient);
}

describe('ReservationRepo 当日キャンセル追跡カラム', () => {
  it('create: status=cancelledなら cancel_source=salonboard_csv(cancelled_atは書かない)', async () => {
    const { calls, repo } = createWriteFake();
    await repo.create({ ...INPUT, status: 'cancelled' });
    expect(calls[0].payload.cancel_source).toBe('salonboard_csv');
    expect('cancelled_at' in calls[0].payload).toBe(false);
  });

  it('create: cancelled以外なら cancel_source=null かつ cancelled_at=null', async () => {
    const { calls, repo } = createWriteFake();
    await repo.create({ ...INPUT, status: 'confirmed' });
    expect(calls[0].payload.cancel_source).toBeNull();
    expect(calls[0].payload.cancelled_at).toBeNull();
  });

  it('update: cancelled→confirmed(CSVで復活)は cancel_source / cancelled_at を両方NULLへ戻す', async () => {
    const { calls, repo } = createWriteFake();
    await repo.update('res-1', { ...INPUT, status: 'confirmed' });
    expect(calls[0].op).toBe('update');
    expect(calls[0].payload.status).toBe('confirmed');
    expect(calls[0].payload.cancel_source).toBeNull();
    expect(calls[0].payload.cancelled_at).toBeNull();
  });

  it('findByNaturalKey: cancel_source を返す', async () => {
    const repo = createSelectFake([{ id: 'a', created_at: '2026-09-01T00:00:00Z', cancel_source: 'salonboard_csv' }]);
    expect(await repo.findByNaturalKey('2026-10-01T01:00:00.000Z', 'cust-1')).toEqual({ id: 'a', cancelSource: 'salonboard_csv' });
  });

  it('findByNaturalKey: 重複行に手動キャンセル済みがあれば、最古の行ではなくそちらを返す(復活防止)', async () => {
    const repo = createSelectFake([
      { id: 'oldest', created_at: '2026-09-01T00:00:00Z', cancel_source: null },
      { id: 'manual-one', created_at: '2026-09-02T00:00:00Z', cancel_source: 'manual' },
    ]);
    expect(await repo.findByNaturalKey('2026-10-01T01:00:00.000Z', 'cust-1')).toEqual({ id: 'manual-one', cancelSource: 'manual' });
  });

  it('findByNaturalKey: 手動キャンセルが無ければ従来どおり最古の1件', async () => {
    const repo = createSelectFake([
      { id: 'oldest', created_at: '2026-09-01T00:00:00Z', cancel_source: null },
      { id: 'newer', created_at: '2026-09-02T00:00:00Z', cancel_source: null },
    ]);
    expect(await repo.findByNaturalKey('2026-10-01T01:00:00.000Z', 'cust-1')).toEqual({ id: 'oldest', cancelSource: null });
  });

  it('findByNaturalKey: 行が無ければnull', async () => {
    expect(await createSelectFake([]).findByNaturalKey('2026-10-01T01:00:00.000Z', 'cust-1')).toBeNull();
  });
});
