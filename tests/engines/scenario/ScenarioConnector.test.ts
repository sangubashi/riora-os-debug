import { describe, expect, it } from 'vitest';
import {
  ScenarioConnector,
  type ProposalResult,
  type ScenarioConnectInput,
} from '../../../src/engines/scenario/ScenarioConnector';
import { ScenarioQueueBuilder } from '../../../src/engines/scenario/ScenarioQueueBuilder';
import {
  ScenarioSelector,
  type ScenarioCandidateRow,
  type ScenarioSelectionProposal,
} from '../../../src/engines/scenario/ScenarioSelector';
import type { EngineDegradedResult, ExplainTexts, FinalProposalSet } from '../../../src/types/riora.types';

const EMPTY_EXPLAIN: ExplainTexts = {
  staffLine1: '',
  staffAvoid: null,
  managerQ1: '',
  managerQ2: '',
  managerQ3: '',
};

function buildFinalProposalSet(overrides: Partial<FinalProposalSet> = {}): FinalProposalSet {
  return {
    inStore: { mandatory: null, secondary: null, candidateDate: null },
    dm: null,
    explanation: EMPTY_EXPLAIN,
    decisionRecordId: null,
    ...overrides,
  };
}

function buildDegradedProposal(overrides: Partial<EngineDegradedResult> = {}): EngineDegradedResult {
  return {
    degraded: true,
    reason: 'upstream failure',
    proposal: buildFinalProposalSet(),
    ...overrides,
  };
}

function buildSelectionProposal(overrides: Partial<ScenarioSelectionProposal> = {}): ScenarioSelectionProposal {
  return {
    customerId: 'customer-1',
    customerType: 'B_pore',
    nowJst: '2026-06-13T10:00:00+09:00',
    ...overrides,
  };
}

function buildCandidateRow(overrides: Partial<ScenarioCandidateRow> = {}): ScenarioCandidateRow {
  return {
    scenarioCode: 'S-001',
    priority: 'medium',
    customerType: 'B_pore',
    channel: 'LINE',
    updatedAt: '2026-06-01T10:00:00+09:00',
    lastSentAt: null,
    ...overrides,
  };
}

function buildInput(overrides: Partial<ScenarioConnectInput> = {}): ScenarioConnectInput {
  return {
    proposalResult: buildFinalProposalSet(),
    selectionProposal: buildSelectionProposal(),
    candidates: [buildCandidateRow()],
    storeId: 'store-1',
    templateId: 'TPL-001',
    scheduledAt: '2026-06-14T10:00:00+09:00',
    ...overrides,
  };
}

function buildConnector(): ScenarioConnector {
  return new ScenarioConnector({ selector: new ScenarioSelector(), queueBuilder: new ScenarioQueueBuilder() });
}

describe('ScenarioConnector', () => {
  describe('正常系: ProposalOrchestrator -> ScenarioSelector -> ScenarioQueueBuilder', () => {
    it('候補が1件で選定可能な場合、selectedとqueuedが共に組み立てられる', () => {
      const connector = buildConnector();
      const result = connector.connect(buildInput());

      expect('degraded' in result).toBe(false);
      const r = result as { selected: unknown; queued: unknown };
      expect(r.selected).toEqual({
        scenarioCode: 'S-001',
        priority: 'medium',
        customerType: 'B_pore',
        channel: 'LINE',
        updatedAt: '2026-06-01T10:00:00+09:00',
      });
      expect(r.queued).toEqual({
        customer_id: 'customer-1',
        store_id: 'store-1',
        scenario_code: 'S-001',
        template_id: 'TPL-001',
        scheduled_at: '2026-06-14T10:00:00+09:00',
        approval_status: 'pending',
      });
    });

    it('queued.approval_statusは常に"pending"である', () => {
      const connector = buildConnector();
      const result = connector.connect(buildInput());
      const r = result as { queued: { approval_status: string } };
      expect(r.queued.approval_status).toBe('pending');
    });

    it('queued.customer_idはselectionProposal.customerIdが使われる', () => {
      const connector = buildConnector();
      const result = connector.connect(buildInput({ selectionProposal: buildSelectionProposal({ customerId: 'customer-xyz' }) }));
      const r = result as { queued: { customer_id: string } };
      expect(r.queued.customer_id).toBe('customer-xyz');
    });

    it('queued.store_idはinput.storeIdが使われる', () => {
      const connector = buildConnector();
      const result = connector.connect(buildInput({ storeId: 'store-xyz' }));
      const r = result as { queued: { store_id: string } };
      expect(r.queued.store_id).toBe('store-xyz');
    });

    it('queued.template_idはinput.templateIdが使われる', () => {
      const connector = buildConnector();
      const result = connector.connect(buildInput({ templateId: 'TPL-XYZ' }));
      const r = result as { queued: { template_id: string } };
      expect(r.queued.template_id).toBe('TPL-XYZ');
    });

    it('queued.scheduled_atはinput.scheduledAtが使われる', () => {
      const connector = buildConnector();
      const result = connector.connect(buildInput({ scheduledAt: '2026-07-01T08:00:00+09:00' }));
      const r = result as { queued: { scheduled_at: string } };
      expect(r.queued.scheduled_at).toBe('2026-07-01T08:00:00+09:00');
    });

    it('queued.scenario_codeはselectedScenario.scenarioCodeと一致する', () => {
      const connector = buildConnector();
      const result = connector.connect(buildInput({ candidates: [buildCandidateRow({ scenarioCode: 'S-MATCH' })] }));
      const r = result as { selected: { scenarioCode: string }; queued: { scenario_code: string } };
      expect(r.queued.scenario_code).toBe(r.selected.scenarioCode);
      expect(r.queued.scenario_code).toBe('S-MATCH');
    });
  });

  describe('該当シナリオなし(正常系・キュー無し)', () => {
    it('候補が空配列の場合はselected/queuedが共にnull', () => {
      const connector = buildConnector();
      const result = connector.connect(buildInput({ candidates: [] }));
      expect(result).toEqual({ selected: null, queued: null });
    });

    it('全候補が7日以内送信済み(suppression全滅)の場合はselected/queuedが共にnull', () => {
      const connector = buildConnector();
      const result = connector.connect(
        buildInput({ candidates: [buildCandidateRow({ lastSentAt: '2026-06-10T10:00:00+09:00' })] })
      );
      expect(result).toEqual({ selected: null, queued: null });
    });
  });

  describe('ProposalOrchestrator側で既に失敗(短絡)', () => {
    it('proposalResultがEngineDegradedResultの場合はそのまま伝播する', () => {
      const connector = buildConnector();
      const degraded = buildDegradedProposal({ reason: 'pattern engine failed' });
      const result = connector.connect(buildInput({ proposalResult: degraded as ProposalResult }));
      expect(result).toEqual(degraded);
    });

    it('短絡時はScenarioSelector/ScenarioQueueBuilderの結果に関わらずdegradedが返る', () => {
      const connector = buildConnector();
      const degraded = buildDegradedProposal({ reason: 'pattern engine failed' });
      const result = connector.connect(
        buildInput({
          proposalResult: degraded as ProposalResult,
          candidates: [buildCandidateRow({ priority: 'critical', updatedAt: '2099-01-01T00:00:00+09:00' })],
        })
      );
      expect(result).toEqual(degraded);
    });
  });

  describe('Step2-2/2-3の選定ロジックがConnector経由でも機能する', () => {
    it('priority上位の候補が優先して選ばれる', () => {
      const connector = buildConnector();
      const candidates = [
        buildCandidateRow({ scenarioCode: 'S-LOW', priority: 'low' }),
        buildCandidateRow({ scenarioCode: 'S-CRITICAL', priority: 'critical' }),
      ];
      const result = connector.connect(buildInput({ candidates }));
      const r = result as { selected: { scenarioCode: string } };
      expect(r.selected.scenarioCode).toBe('S-CRITICAL');
    });

    it('customer_type一致の候補が優先して選ばれる', () => {
      const connector = buildConnector();
      const candidates = [
        buildCandidateRow({ scenarioCode: 'S-MATCH', customerType: 'B_pore', updatedAt: '2026-06-01T10:00:00+09:00' }),
        buildCandidateRow({ scenarioCode: 'S-OTHER', customerType: 'A_acne', updatedAt: '2026-06-10T10:00:00+09:00' }),
      ];
      const result = connector.connect(buildInput({ selectionProposal: buildSelectionProposal({ customerType: 'B_pore' }), candidates }));
      const r = result as { selected: { scenarioCode: string } };
      expect(r.selected.scenarioCode).toBe('S-MATCH');
    });

    it('channel=LINEの候補が優先して選ばれる', () => {
      const connector = buildConnector();
      const candidates = [
        buildCandidateRow({ scenarioCode: 'S-LINE', channel: 'LINE', updatedAt: '2026-06-01T10:00:00+09:00' }),
        buildCandidateRow({ scenarioCode: 'S-SMS', channel: 'SMS', updatedAt: '2026-06-10T10:00:00+09:00' }),
      ];
      const result = connector.connect(buildInput({ candidates }));
      const r = result as { selected: { scenarioCode: string } };
      expect(r.selected.scenarioCode).toBe('S-LINE');
    });
  });

  describe('例外禁止(EngineDegradedResultへ正規化)', () => {
    it('ScenarioSelectorがdegraded結果を返した場合はEngineDegradedResultへ正規化される', () => {
      const connector = buildConnector();
      const result = connector.connect(buildInput({ candidates: null as unknown as ScenarioCandidateRow[] }));
      expect(result).toEqual({
        degraded: true,
        reason: expect.any(String),
        proposal: buildFinalProposalSet(),
      });
    });

    it('proposalResultがnull等の不正値でも例外を投げずEngineDegradedResultへ正規化される', () => {
      const connector = buildConnector();
      const result = connector.connect(buildInput({ proposalResult: null as unknown as ProposalResult }));
      expect(result).toEqual({
        degraded: true,
        reason: expect.any(String),
        proposal: buildFinalProposalSet(),
      });
    });
  });

  describe('決定論', () => {
    it('同一入力を複数回実行しても同じ結果が返る', () => {
      const connector = buildConnector();
      const input = buildInput({
        candidates: [
          buildCandidateRow({ scenarioCode: 'S-1', priority: 'high', updatedAt: '2026-06-01T10:00:00+09:00' }),
          buildCandidateRow({ scenarioCode: 'S-2', priority: 'high', updatedAt: '2026-06-10T10:00:00+09:00' }),
        ],
      });
      const results = Array.from({ length: 20 }, () => connector.connect(input));
      const serialized = results.map((r) => JSON.stringify(r));
      expect(new Set(serialized).size).toBe(1);
    });
  });
});
