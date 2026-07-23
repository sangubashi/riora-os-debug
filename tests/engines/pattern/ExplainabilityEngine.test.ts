// ================================================================
// ExplainabilityEngine 検証(AI提案本物化)
//
// 決定論・LLM不使用。テンプレートに埋め込む値は実際のScoredCandidate/Resolution
// (FireScore内訳・候補コード)であり、固定文言ではない(入力が変われば
// 出力文言も変わることをテストで確認する)。
// ================================================================
import { describe, expect, it } from 'vitest';
import { computeDecisiveFactor, explainResolution } from '../../../src/engines/pattern/ExplainabilityEngine';
import type { Candidate, ScoredCandidate, Resolution, RejectedCandidate } from '../../../src/types/riora.types';

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    uid: 'cand-1', code: 'A1-step2', channel: 'in_store', patternCode: 'A1', stepNo: 2, customerType: null,
    proposalKind: 'homecare', isSales: true, priorityClass: 1, hardCondition: { '==': [1, 1] },
    softFeatures: { weights: {} }, baseScript: 'base', cooldownVisits: 2, lifecycleStatus: 'active', version: 1,
    ...overrides,
  };
}

function scored(overrides: Partial<ScoredCandidate> = {}): ScoredCandidate {
  return {
    candidate: candidate(),
    features: { timing_proximity: 0.8, cycle_position: 0.5, condition_margin: 0.5, type_confidence: 0.8, csi_alignment: 0.5, skin_momentum: 0 },
    breakdown: { successRate: 20, contextFit: 15, timing: 25, affinity: 10, urgency: 15, overrideBoost: 0, churnPenalty: 0 },
    fireScore: 85,
    ...overrides,
  };
}

function resolution(overrides: Partial<Resolution> = {}): Resolution {
  return { inStore: { mandatory: null, secondary: null }, dm: null, rejected: [], tiebreakUsed: false, ...overrides };
}

describe('computeDecisiveFactor', () => {
  it('breakdownのうち最大寄与の項目を実データから返す(固定文言ではない)', () => {
    const sc = scored({ breakdown: { successRate: 5, contextFit: 5, timing: 40, affinity: 5, urgency: 5, overrideBoost: 0, churnPenalty: 0 } });
    expect(computeDecisiveFactor(sc)).toBe('タイミングの良さ(寄与40.0点)');
  });

  it('breakdownが異なれば決定打の文言も変わる(同一入力で固定にならないことの確認)', () => {
    const a = computeDecisiveFactor(scored({ breakdown: { successRate: 50, contextFit: 1, timing: 1, affinity: 1, urgency: 1, overrideBoost: 0, churnPenalty: 0 } }));
    const b = computeDecisiveFactor(scored({ breakdown: { successRate: 1, contextFit: 1, timing: 1, affinity: 50, urgency: 1, overrideBoost: 0, churnPenalty: 0 } }));
    expect(a).not.toBe(b);
    expect(a).toContain('成功率');
    expect(b).toContain('相性');
  });

  it('churnPenaltyは決定打の対象外(減点要素のため採用理由にしない)', () => {
    const sc = scored({ breakdown: { successRate: 1, contextFit: 1, timing: 1, affinity: 1, urgency: 1, overrideBoost: 0, churnPenalty: 99 } });
    expect(computeDecisiveFactor(sc)).not.toContain('離脱');
  });

  it('overrideBoostが既定値1.0(無補正)の場合は決定打の対象外(加点要素と同一スケールでないため)', () => {
    // overrideBoost=1(既定・無補正)は他の加点要素(successRate等)より数値が大きくても
    // 決定打にしてはならない(乗算修飾子であり「1.0が一番効いた」は意味をなさない)。
    const sc = scored({ breakdown: { successRate: 0.5, contextFit: 0.3, timing: 0.2, affinity: 0.1, urgency: 0.1, overrideBoost: 1, churnPenalty: 1 } });
    expect(computeDecisiveFactor(sc)).toBe('過去の成功率(寄与0.5点)');
  });

  it('overrideBoostが既定値以外(O1手動指定等)の場合は決定打として残る', () => {
    const sc = scored({ breakdown: { successRate: 0.1, contextFit: 0.1, timing: 0.1, affinity: 0.1, urgency: 0.1, overrideBoost: 1.5, churnPenalty: 1 } });
    expect(computeDecisiveFactor(sc)).toBe('手動指定による加点(寄与1.5点)');
  });
});

describe('explainResolution', () => {
  it('mandatoryが無い場合は「提案なし」の実情を返す(固定の提案文言を作らない)', () => {
    const result = explainResolution({ mandatory: null, secondary: null, resolution: resolution() });
    expect(result.staffLine1).toContain('発火条件を満たす提案はありません');
    expect(result.managerQ3).toBe('該当なし。');
  });

  it('mandatoryがある場合、実際のcode/fireScore/decisiveFactorを埋め込んだ説明文を返す', () => {
    const mandatory = scored();
    const result = explainResolution({ mandatory, secondary: null, resolution: resolution() });
    expect(result.staffLine1).toContain('A1-step2');
    expect(result.staffLine1).toContain('85');
    expect(result.managerQ1).toContain('A1-step2');
  });

  it('isSales=trueの場合、staffAvoidに販売重複の注意文を返す', () => {
    const mandatory = scored({ candidate: candidate({ isSales: true }) });
    const result = explainResolution({ mandatory, secondary: null, resolution: resolution() });
    expect(result.staffAvoid).toContain('1件まで');
  });

  it('isSales=falseの場合、staffAvoidはnull', () => {
    const mandatory = scored({ candidate: candidate({ isSales: false }) });
    const result = explainResolution({ mandatory, secondary: null, resolution: resolution() });
    expect(result.staffAvoid).toBeNull();
  });

  it('rejected候補がある場合、実際の候補コード・却下理由をmanagerQ2に列挙する', () => {
    const mandatory = scored();
    const rejected: RejectedCandidate[] = [
      { candidate: candidate({ code: 'B1-step3' }), stageReached: 2, blockedBy: 'G-CHURN' },
    ];
    const result = explainResolution({ mandatory, secondary: null, resolution: resolution({ rejected }) });
    expect(result.managerQ2).toContain('B1-step3');
    expect(result.managerQ2).toContain('離脱リスク');
  });
});
