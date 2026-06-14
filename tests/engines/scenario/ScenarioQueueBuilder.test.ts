import { describe, expect, it } from 'vitest';
import {
  ScenarioQueueBuilder,
  type LineSendQueuePayload,
  type ScenarioQueueBuildInput,
} from '../../../src/engines/scenario/ScenarioQueueBuilder';
import type { SelectedScenario } from '../../../src/engines/scenario/ScenarioSelector';

function buildSelected(overrides: Partial<SelectedScenario> = {}): SelectedScenario {
  return {
    scenarioCode: 'S-001',
    priority: 'medium',
    customerType: 'B_pore',
    channel: 'LINE',
    updatedAt: '2026-06-01T10:00:00+09:00',
    ...overrides,
  };
}

function buildInput(overrides: Partial<ScenarioQueueBuildInput> = {}): ScenarioQueueBuildInput {
  return {
    selected: buildSelected(),
    customerId: 'customer-1',
    storeId: 'store-1',
    templateId: 'TPL-001',
    scheduledAt: '2026-06-14T10:00:00+09:00',
    ...overrides,
  };
}

const builder = new ScenarioQueueBuilder();

describe('ScenarioQueueBuilder', () => {
  it('SelectedScenarioとInputから全フィールドが正しくマッピングされる', () => {
    const result = builder.build(buildInput());
    expect(result).toEqual({
      customer_id: 'customer-1',
      store_id: 'store-1',
      scenario_code: 'S-001',
      template_id: 'TPL-001',
      scheduled_at: '2026-06-14T10:00:00+09:00',
      approval_status: 'pending',
    });
  });

  it('approval_statusは常に"pending"固定である', () => {
    const result = builder.build(buildInput());
    expect(result.approval_status).toBe('pending');
  });

  it('customer_idはinput.customerIdが反映される', () => {
    const result = builder.build(buildInput({ customerId: 'customer-xyz' }));
    expect(result.customer_id).toBe('customer-xyz');
  });

  it('store_idはinput.storeIdが反映される', () => {
    const result = builder.build(buildInput({ storeId: 'store-xyz' }));
    expect(result.store_id).toBe('store-xyz');
  });

  it('scenario_codeはselected.scenarioCodeが反映される', () => {
    const result = builder.build(buildInput({ selected: buildSelected({ scenarioCode: 'S-XYZ' }) }));
    expect(result.scenario_code).toBe('S-XYZ');
  });

  it('template_idはinput.templateIdが反映される', () => {
    const result = builder.build(buildInput({ templateId: 'TPL-XYZ' }));
    expect(result.template_id).toBe('TPL-XYZ');
  });

  it('scheduled_atはinput.scheduledAtが反映される', () => {
    const result = builder.build(buildInput({ scheduledAt: '2026-07-01T08:00:00+09:00' }));
    expect(result.scheduled_at).toBe('2026-07-01T08:00:00+09:00');
  });

  it('戻り値はLineSendQueuePayloadの6キーのみを持つ', () => {
    const result = builder.build(buildInput());
    expect(Object.keys(result).sort()).toEqual(
      ['approval_status', 'customer_id', 'scenario_code', 'scheduled_at', 'store_id', 'template_id'].sort()
    );
  });

  it('priority="critical"のSelectedScenarioでもscenario_codeは正しく反映される', () => {
    const result = builder.build(buildInput({ selected: buildSelected({ scenarioCode: 'S-CRITICAL', priority: 'critical' }) }));
    expect(result.scenario_code).toBe('S-CRITICAL');
    expect(result.approval_status).toBe('pending');
  });

  it('priority="low"のSelectedScenarioでもscenario_codeは正しく反映される', () => {
    const result = builder.build(buildInput({ selected: buildSelected({ scenarioCode: 'S-LOW', priority: 'low' }) }));
    expect(result.scenario_code).toBe('S-LOW');
    expect(result.approval_status).toBe('pending');
  });

  it('selected.customerTypeの値はcustomer_id/store_id等の組み立てに影響しない', () => {
    const a = builder.build(buildInput({ selected: buildSelected({ customerType: 'A_acne' }) }));
    const b = builder.build(buildInput({ selected: buildSelected({ customerType: 'E_bridal' }) }));
    expect(a.customer_id).toBe(b.customer_id);
    expect(a.store_id).toBe(b.store_id);
    expect(a.template_id).toBe(b.template_id);
    expect(a.scheduled_at).toBe(b.scheduled_at);
  });

  it('channel="SMS"のSelectedScenarioでも変換結果の形は変わらない', () => {
    const result = builder.build(buildInput({ selected: buildSelected({ channel: 'SMS' }) }));
    expect(result).toEqual({
      customer_id: 'customer-1',
      store_id: 'store-1',
      scenario_code: 'S-001',
      template_id: 'TPL-001',
      scheduled_at: '2026-06-14T10:00:00+09:00',
      approval_status: 'pending',
    });
  });

  it('channel="EMAIL"のSelectedScenarioでも変換結果の形は変わらない', () => {
    const result = builder.build(buildInput({ selected: buildSelected({ channel: 'EMAIL' }) }));
    expect(result).toEqual({
      customer_id: 'customer-1',
      store_id: 'store-1',
      scenario_code: 'S-001',
      template_id: 'TPL-001',
      scheduled_at: '2026-06-14T10:00:00+09:00',
      approval_status: 'pending',
    });
  });

  it('異なるcustomerId/storeId/templateId/scheduledAtの組み合わせで正しくマッピングされる', () => {
    const cases: Array<{ customerId: string; storeId: string; templateId: string; scheduledAt: string }> = [
      { customerId: 'c-1', storeId: 'st-1', templateId: 'T-1', scheduledAt: '2026-06-15T10:00:00+09:00' },
      { customerId: 'c-2', storeId: 'st-2', templateId: 'T-2', scheduledAt: '2026-06-16T20:00:00+09:00' },
      { customerId: 'c-3', storeId: 'st-3', templateId: 'T-3', scheduledAt: '2026-06-17T07:30:00+09:00' },
    ];

    for (const c of cases) {
      const result = builder.build(buildInput(c));
      expect(result.customer_id).toBe(c.customerId);
      expect(result.store_id).toBe(c.storeId);
      expect(result.template_id).toBe(c.templateId);
      expect(result.scheduled_at).toBe(c.scheduledAt);
      expect(result.approval_status).toBe('pending');
    }
  });

  it('scheduledAtに様々なISO日時フォーマットを渡してもそのまま転記される', () => {
    const utc = builder.build(buildInput({ scheduledAt: '2026-06-20T01:00:00.000Z' }));
    expect(utc.scheduled_at).toBe('2026-06-20T01:00:00.000Z');

    const jst = builder.build(buildInput({ scheduledAt: '2026-06-20T10:00:00+09:00' }));
    expect(jst.scheduled_at).toBe('2026-06-20T10:00:00+09:00');
  });

  it('決定論: 同一入力を複数回実行しても同じ結果が返る', () => {
    const input = buildInput();
    const results = Array.from({ length: 20 }, () => builder.build(input));
    const serialized = results.map((r) => JSON.stringify(r));
    expect(new Set(serialized).size).toBe(1);
  });

  it('同一Builderインスタンスを異なる入力で呼び出しても独立した結果が返る(状態を持たない)', () => {
    const first = builder.build(buildInput({ customerId: 'customer-first', selected: buildSelected({ scenarioCode: 'S-FIRST' }) }));
    const second = builder.build(buildInput({ customerId: 'customer-second', selected: buildSelected({ scenarioCode: 'S-SECOND' }) }));

    expect(first.customer_id).toBe('customer-first');
    expect(first.scenario_code).toBe('S-FIRST');
    expect(second.customer_id).toBe('customer-second');
    expect(second.scenario_code).toBe('S-SECOND');
  });

  it('selected.updatedAtの値はLineSendQueuePayloadに含まれない(scheduled_atとは別物)', () => {
    const result: LineSendQueuePayload = builder.build(
      buildInput({
        selected: buildSelected({ updatedAt: '2099-01-01T00:00:00+09:00' }),
        scheduledAt: '2026-06-14T10:00:00+09:00',
      })
    );
    expect(result.scheduled_at).toBe('2026-06-14T10:00:00+09:00');
    expect(Object.values(result)).not.toContain('2099-01-01T00:00:00+09:00');
  });
});
