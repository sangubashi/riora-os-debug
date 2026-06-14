import { describe, expect, it } from 'vitest';
import {
  ScenarioSelector,
  type ScenarioCandidateRow,
  type ScenarioSelectionProposal,
  type ScenarioSelectorInput,
  type SelectedScenario,
} from '../../../src/engines/scenario/ScenarioSelector';

function buildCandidate(overrides: Partial<ScenarioCandidateRow> = {}): ScenarioCandidateRow {
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

function buildProposal(overrides: Partial<ScenarioSelectionProposal> = {}): ScenarioSelectionProposal {
  return {
    customerId: 'customer-1',
    customerType: 'B_pore',
    nowJst: '2026-06-13T10:00:00+09:00',
    ...overrides,
  };
}

function buildInput(overrides: Partial<ScenarioSelectorInput> = {}): ScenarioSelectorInput {
  return {
    proposal: buildProposal(),
    candidates: [buildCandidate()],
    ...overrides,
  };
}

const selector = new ScenarioSelector();

describe('ScenarioSelector', () => {
  describe('入力なし', () => {
    it('候補が空配列の場合はnullを返す', () => {
      const result = selector.select(buildInput({ candidates: [] }));
      expect(result).toBeNull();
    });

    it('候補が1件のみでsuppression対象外の場合はその候補が選ばれる', () => {
      const candidate = buildCandidate({ scenarioCode: 'S-100' });
      const result = selector.select(buildInput({ candidates: [candidate] }));
      expect(result).toEqual({
        scenarioCode: 'S-100',
        priority: 'medium',
        customerType: 'B_pore',
        channel: 'LINE',
        updatedAt: '2026-06-01T10:00:00+09:00',
      });
    });
  });

  describe('Step1: suppression(7日以内同一scenario送信済み)', () => {
    it('7日以内に送信済みの候補は除外される', () => {
      const suppressed = buildCandidate({ scenarioCode: 'S-SUPPRESSED', lastSentAt: '2026-06-10T10:00:00+09:00' });
      const available = buildCandidate({ scenarioCode: 'S-AVAILABLE', lastSentAt: null });
      const result = selector.select(buildInput({ candidates: [suppressed, available] }));
      expect((result as SelectedScenario).scenarioCode).toBe('S-AVAILABLE');
    });

    it('全候補が7日以内送信済みの場合はnullを返す', () => {
      const candidates = [
        buildCandidate({ scenarioCode: 'S-1', lastSentAt: '2026-06-10T10:00:00+09:00' }),
        buildCandidate({ scenarioCode: 'S-2', lastSentAt: '2026-06-12T10:00:00+09:00' }),
      ];
      const result = selector.select(buildInput({ candidates }));
      expect(result).toBeNull();
    });

    it('ちょうど7日前に送信済みの候補は抑制される(境界値: 7日以内=含む)', () => {
      const exactly7d = buildCandidate({ scenarioCode: 'S-7D', lastSentAt: '2026-06-06T10:00:00+09:00' });
      const fallback = buildCandidate({ scenarioCode: 'S-FALLBACK', lastSentAt: null });
      const result = selector.select(buildInput({ candidates: [exactly7d, fallback] }));
      expect((result as SelectedScenario).scenarioCode).toBe('S-FALLBACK');
    });

    it('8日前に送信済みの候補は抑制されない(境界値)', () => {
      const candidate = buildCandidate({ scenarioCode: 'S-8D', lastSentAt: '2026-06-05T10:00:00+09:00' });
      const result = selector.select(buildInput({ candidates: [candidate] }));
      expect((result as SelectedScenario).scenarioCode).toBe('S-8D');
    });

    it('lastSentAtがnullの候補は抑制対象にならない', () => {
      const candidate = buildCandidate({ scenarioCode: 'S-NEW', lastSentAt: null });
      const result = selector.select(buildInput({ candidates: [candidate] }));
      expect((result as SelectedScenario).scenarioCode).toBe('S-NEW');
    });
  });

  describe('Step2: priority順(critical > high > medium > low)', () => {
    it('criticalがある場合は他のpriorityは除外される', () => {
      const candidates = [
        buildCandidate({ scenarioCode: 'S-LOW', priority: 'low' }),
        buildCandidate({ scenarioCode: 'S-MEDIUM', priority: 'medium' }),
        buildCandidate({ scenarioCode: 'S-HIGH', priority: 'high' }),
        buildCandidate({ scenarioCode: 'S-CRITICAL', priority: 'critical' }),
      ];
      const result = selector.select(buildInput({ candidates }));
      expect((result as SelectedScenario).scenarioCode).toBe('S-CRITICAL');
    });

    it('criticalが無い場合はhighが最上位として残る', () => {
      const candidates = [
        buildCandidate({ scenarioCode: 'S-LOW', priority: 'low' }),
        buildCandidate({ scenarioCode: 'S-MEDIUM', priority: 'medium' }),
        buildCandidate({ scenarioCode: 'S-HIGH', priority: 'high' }),
      ];
      const result = selector.select(buildInput({ candidates }));
      expect((result as SelectedScenario).scenarioCode).toBe('S-HIGH');
    });

    it('mediumとlowが混在する場合はmediumが残る', () => {
      const candidates = [
        buildCandidate({ scenarioCode: 'S-LOW', priority: 'low' }),
        buildCandidate({ scenarioCode: 'S-MEDIUM', priority: 'medium' }),
      ];
      const result = selector.select(buildInput({ candidates }));
      expect((result as SelectedScenario).scenarioCode).toBe('S-MEDIUM');
    });

    it('同じpriorityの複数候補は両方とも次のStepへ進む(Step5のtie breakで決まる)', () => {
      const candidates = [
        buildCandidate({ scenarioCode: 'S-OLD', priority: 'high', updatedAt: '2026-06-01T10:00:00+09:00' }),
        buildCandidate({ scenarioCode: 'S-NEW', priority: 'high', updatedAt: '2026-06-10T10:00:00+09:00' }),
      ];
      const result = selector.select(buildInput({ candidates }));
      expect((result as SelectedScenario).scenarioCode).toBe('S-NEW');
    });
  });

  describe('Step3: customer_type適合(一致優先)', () => {
    it('proposalのcustomerTypeと一致する候補があれば一致候補のみ残る', () => {
      const candidates = [
        buildCandidate({ scenarioCode: 'S-MATCH', customerType: 'B_pore', updatedAt: '2026-06-01T10:00:00+09:00' }),
        buildCandidate({ scenarioCode: 'S-OTHER', customerType: 'A_acne', updatedAt: '2026-06-10T10:00:00+09:00' }),
      ];
      const result = selector.select(buildInput({ proposal: buildProposal({ customerType: 'B_pore' }), candidates }));
      // S-OTHERのupdatedAtが新しいが、customerType不一致のため除外されS-MATCHが選ばれる
      expect((result as SelectedScenario).scenarioCode).toBe('S-MATCH');
    });

    it('一致するcustomerTypeの候補が無い場合は絞り込まれない', () => {
      const candidates = [
        buildCandidate({ scenarioCode: 'S-A', customerType: 'A_acne', updatedAt: '2026-06-01T10:00:00+09:00' }),
        buildCandidate({ scenarioCode: 'S-C', customerType: 'C_sensitive', updatedAt: '2026-06-10T10:00:00+09:00' }),
      ];
      const result = selector.select(buildInput({ proposal: buildProposal({ customerType: 'D_aging' }), candidates }));
      // どちらもproposal.customerType('D_aging')と不一致のため絞られず、Step5でS-Cが選ばれる
      expect((result as SelectedScenario).scenarioCode).toBe('S-C');
    });
  });

  describe('Step4: 送信チャネル判定(LINE優先)', () => {
    it('LINEチャネルの候補があればLINEのみ残る', () => {
      const candidates = [
        buildCandidate({ scenarioCode: 'S-LINE', channel: 'LINE', updatedAt: '2026-06-01T10:00:00+09:00' }),
        buildCandidate({ scenarioCode: 'S-SMS', channel: 'SMS', updatedAt: '2026-06-10T10:00:00+09:00' }),
      ];
      const result = selector.select(buildInput({ candidates }));
      // S-SMSのupdatedAtが新しいが、LINE優先のためS-LINEが選ばれる
      expect((result as SelectedScenario).scenarioCode).toBe('S-LINE');
    });

    it('LINEチャネルの候補が無い場合は絞り込まれない', () => {
      const candidates = [
        buildCandidate({ scenarioCode: 'S-SMS', channel: 'SMS', updatedAt: '2026-06-01T10:00:00+09:00' }),
        buildCandidate({ scenarioCode: 'S-EMAIL', channel: 'EMAIL', updatedAt: '2026-06-10T10:00:00+09:00' }),
      ];
      const result = selector.select(buildInput({ candidates }));
      expect((result as SelectedScenario).scenarioCode).toBe('S-EMAIL');
    });
  });

  describe('Step5: 最終Tie Break(updated_at DESC)', () => {
    it('残った候補の中でupdatedAtが最新のものが選ばれる', () => {
      const candidates = [
        buildCandidate({ scenarioCode: 'S-OLDEST', updatedAt: '2026-06-01T10:00:00+09:00' }),
        buildCandidate({ scenarioCode: 'S-NEWEST', updatedAt: '2026-06-12T10:00:00+09:00' }),
        buildCandidate({ scenarioCode: 'S-MIDDLE', updatedAt: '2026-06-06T10:00:00+09:00' }),
      ];
      const result = selector.select(buildInput({ candidates }));
      expect((result as SelectedScenario).scenarioCode).toBe('S-NEWEST');
    });

    it('updatedAtが同一の場合は配列の先頭の候補が選ばれる(安定ソート)', () => {
      const candidates = [
        buildCandidate({ scenarioCode: 'S-FIRST', updatedAt: '2026-06-10T10:00:00+09:00' }),
        buildCandidate({ scenarioCode: 'S-SECOND', updatedAt: '2026-06-10T10:00:00+09:00' }),
      ];
      const result = selector.select(buildInput({ candidates }));
      expect((result as SelectedScenario).scenarioCode).toBe('S-FIRST');
    });
  });

  describe('Step間の相互作用', () => {
    it('Step1とStep2: criticalが抑制されている場合はhighが選ばれる', () => {
      const candidates = [
        buildCandidate({ scenarioCode: 'S-CRITICAL-SUPPRESSED', priority: 'critical', lastSentAt: '2026-06-10T10:00:00+09:00' }),
        buildCandidate({ scenarioCode: 'S-HIGH', priority: 'high', lastSentAt: null }),
      ];
      const result = selector.select(buildInput({ candidates }));
      expect((result as SelectedScenario).scenarioCode).toBe('S-HIGH');
    });

    it('Step3はStep4より優先される: customer_type一致(non-LINE)がLINE(不一致)より優先される', () => {
      const candidates = [
        buildCandidate({ scenarioCode: 'S-MATCH-SMS', customerType: 'B_pore', channel: 'SMS', updatedAt: '2026-06-01T10:00:00+09:00' }),
        buildCandidate({ scenarioCode: 'S-UNMATCH-LINE', customerType: 'A_acne', channel: 'LINE', updatedAt: '2026-06-12T10:00:00+09:00' }),
      ];
      const result = selector.select(buildInput({ proposal: buildProposal({ customerType: 'B_pore' }), candidates }));
      // Step3でS-UNMATCH-LINEはcustomerType不一致のため除外され、S-MATCH-SMSが選ばれる
      expect((result as SelectedScenario).scenarioCode).toBe('S-MATCH-SMS');
    });

    it('E2E: 全Stepを通して正しい1件が選ばれる', () => {
      const candidates = [
        // 抑制される(7日以内送信済み)
        buildCandidate({ scenarioCode: 'S-SUPPRESSED', priority: 'critical', lastSentAt: '2026-06-12T10:00:00+09:00' }),
        // priorityが最上位ではないため除外される
        buildCandidate({ scenarioCode: 'S-LOW-PRIORITY', priority: 'low', customerType: 'B_pore', channel: 'LINE', updatedAt: '2026-06-12T10:00:00+09:00' }),
        // customerType不一致のため除外される
        buildCandidate({ scenarioCode: 'S-WRONG-TYPE', priority: 'high', customerType: 'A_acne', channel: 'LINE', updatedAt: '2026-06-12T10:00:00+09:00' }),
        // 正解: priority=high, customerType一致, channel=LINE
        buildCandidate({ scenarioCode: 'S-WINNER', priority: 'high', customerType: 'B_pore', channel: 'LINE', updatedAt: '2026-06-05T10:00:00+09:00' }),
      ];
      const result = selector.select(buildInput({ proposal: buildProposal({ customerType: 'B_pore' }), candidates }));
      expect((result as SelectedScenario).scenarioCode).toBe('S-WINNER');
    });
  });

  describe('戻り値の形', () => {
    it('SelectedScenarioは候補の全フィールドを正しく反映する', () => {
      const candidate = buildCandidate({
        scenarioCode: 'S-FULL',
        priority: 'critical',
        customerType: 'E_bridal',
        channel: 'EMAIL',
        updatedAt: '2026-06-11T08:30:00+09:00',
        lastSentAt: null,
      });
      const result = selector.select(buildInput({ proposal: buildProposal({ customerType: 'E_bridal' }), candidates: [candidate] }));
      expect(result).toEqual({
        scenarioCode: 'S-FULL',
        priority: 'critical',
        customerType: 'E_bridal',
        channel: 'EMAIL',
        updatedAt: '2026-06-11T08:30:00+09:00',
      });
    });
  });

  describe('例外禁止(EngineDegradedResultへ正規化)', () => {
    it('不正な入力(candidatesがnull)が渡された場合は例外を投げずDegraded結果を返す', () => {
      const result = selector.select({
        proposal: buildProposal(),
        candidates: null as unknown as ScenarioCandidateRow[],
      });
      expect(result).toEqual({
        degraded: true,
        reason: expect.any(String),
        selected: null,
      });
    });
  });

  describe('決定論', () => {
    it('同一入力を複数回実行しても同じ結果が返る', () => {
      const input = buildInput({
        candidates: [
          buildCandidate({ scenarioCode: 'S-1', priority: 'high', updatedAt: '2026-06-01T10:00:00+09:00' }),
          buildCandidate({ scenarioCode: 'S-2', priority: 'high', updatedAt: '2026-06-10T10:00:00+09:00' }),
          buildCandidate({ scenarioCode: 'S-3', priority: 'medium', updatedAt: '2026-06-12T10:00:00+09:00' }),
        ],
      });
      const results = Array.from({ length: 20 }, () => selector.select(input));
      const serialized = results.map((r) => JSON.stringify(r));
      expect(new Set(serialized).size).toBe(1);
      expect(results[0]).not.toBeNull();
    });
  });
});
