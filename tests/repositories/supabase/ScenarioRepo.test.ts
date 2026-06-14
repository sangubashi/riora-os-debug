import { describe, expect, it } from 'vitest';
import { ScenarioRepo } from '../../../src/repositories/supabase/ScenarioRepo';
import { createQueryBuilderMock, createSupabaseMock, type MockResult } from './testUtils';
import type { BrainScenarioRow } from '../../../src/repositories/supabase/mappers';

const SCENARIO_ROW: BrainScenarioRow = {
  id: 'scenario-A',
  priority: 'high',
  customer_type: 'B_pore',
  channel: 'LINE',
  updated_at: '2026-06-01T00:00:00Z',
};

function createScenarioMock(scenariosResult: MockResult, sentResult: MockResult) {
  const scenariosBuilder = createQueryBuilderMock(scenariosResult);
  const sentBuilder = createQueryBuilderMock(sentResult);
  const client = createSupabaseMock((table) => (table === 'brain_scenarios' ? scenariosBuilder : sentBuilder));
  return { client, scenariosBuilder, sentBuilder };
}

describe('ScenarioRepo', () => {
  describe('loadActive', () => {
    it('送信履歴がない場合はlastSentAt=nullで返す', async () => {
      const { client } = createScenarioMock({ data: [SCENARIO_ROW], error: null }, { data: [], error: null });
      const repo = new ScenarioRepo(client);

      const result = await repo.loadActive('store-1', 'cust-1');

      expect(result).toEqual([
        {
          scenarioCode: 'scenario-A',
          priority: 'high',
          customerType: 'B_pore',
          channel: 'LINE',
          updatedAt: '2026-06-01T00:00:00Z',
          lastSentAt: null,
        },
      ]);
    });

    it('送信履歴がある場合はlastSentAtを付与する', async () => {
      const { client } = createScenarioMock(
        { data: [SCENARIO_ROW], error: null },
        { data: [{ trigger_type: 'scenario-A', created_at: '2026-06-10T00:00:00Z' }], error: null }
      );
      const repo = new ScenarioRepo(client);

      const result = await repo.loadActive('store-1', 'cust-1');

      expect(result[0].lastSentAt).toBe('2026-06-10T00:00:00Z');
    });

    it('同一trigger_typeの複数送信履歴から最新のcreated_atを採用する', async () => {
      const { client } = createScenarioMock(
        { data: [SCENARIO_ROW], error: null },
        {
          data: [
            { trigger_type: 'scenario-A', created_at: '2026-06-01T00:00:00Z' },
            { trigger_type: 'scenario-A', created_at: '2026-06-10T00:00:00Z' },
            { trigger_type: 'scenario-A', created_at: '2026-06-05T00:00:00Z' },
          ],
          error: null,
        }
      );
      const repo = new ScenarioRepo(client);

      const result = await repo.loadActive('store-1', 'cust-1');

      expect(result[0].lastSentAt).toBe('2026-06-10T00:00:00Z');
    });

    it('アクティブなscenarioがない場合は空配列を返す', async () => {
      const { client } = createScenarioMock({ data: [], error: null }, { data: [], error: null });
      const repo = new ScenarioRepo(client);

      const result = await repo.loadActive('store-1', 'cust-1');

      expect(result).toEqual([]);
    });

    it('brain_scenarios取得でerrorの場合はScenarioRepo.loadActive failedで例外を投げる', async () => {
      const { client } = createScenarioMock(
        { data: null, error: { message: 'scenarios error' } },
        { data: [], error: null }
      );
      const repo = new ScenarioRepo(client);

      await expect(repo.loadActive('store-1', 'cust-1')).rejects.toThrow(
        'ScenarioRepo.loadActive failed: scenarios error'
      );
    });

    it('送信履歴取得でerrorの場合はScenarioRepo.loadActive failedで例外を投げる', async () => {
      const { client } = createScenarioMock(
        { data: [SCENARIO_ROW], error: null },
        { data: null, error: { message: 'sent error' } }
      );
      const repo = new ScenarioRepo(client);

      await expect(repo.loadActive('store-1', 'cust-1')).rejects.toThrow(
        'ScenarioRepo.loadActive failed: sent error'
      );
    });

    it('store_id=storeIdまたはNULL(ブランド標準)でis_active=trueのscenarioを取得する', async () => {
      const { scenariosBuilder, sentBuilder, client } = createScenarioMock(
        { data: [SCENARIO_ROW], error: null },
        { data: [], error: null }
      );
      const repo = new ScenarioRepo(client);

      await repo.loadActive('store-123', 'cust-1');

      expect(scenariosBuilder.or).toHaveBeenCalledWith('store_id.eq.store-123,store_id.is.null');
      expect(scenariosBuilder.eq).toHaveBeenCalledWith('is_active', true);
      expect(sentBuilder.eq).toHaveBeenCalledWith('customer_id', 'cust-1');
      expect(sentBuilder.eq).toHaveBeenCalledWith('status', 'sent');
    });

    it('他scenarioの送信履歴は別scenarioのlastSentAtに影響しない', async () => {
      const scenarioB: BrainScenarioRow = { ...SCENARIO_ROW, id: 'scenario-B' };
      const { client } = createScenarioMock(
        { data: [SCENARIO_ROW, scenarioB], error: null },
        { data: [{ trigger_type: 'scenario-A', created_at: '2026-06-10T00:00:00Z' }], error: null }
      );
      const repo = new ScenarioRepo(client);

      const result = await repo.loadActive('store-1', 'cust-1');

      const a = result.find((r) => r.scenarioCode === 'scenario-A');
      const b = result.find((r) => r.scenarioCode === 'scenario-B');
      expect(a?.lastSentAt).toBe('2026-06-10T00:00:00Z');
      expect(b?.lastSentAt).toBeNull();
    });
  });
});
