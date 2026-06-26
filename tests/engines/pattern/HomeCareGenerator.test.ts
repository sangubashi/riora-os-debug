// ================================================================
// HomeCareGenerator 検証(AI提案本物化)
//
// brain_*に実商品カタログが無いため、商品名・価格は提示しない
// (架空の商品名を作らない・カテゴリ参考のみ実候補コードから生成)。
// ================================================================
import { describe, expect, it } from 'vitest';
import { generateHomeCareNote } from '../../../src/engines/pattern/HomeCareGenerator';
import type { Candidate } from '../../../src/types/riora.types';

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    uid: 'cand-1', code: 'A1-step2', channel: 'in_store', patternCode: 'A1', stepNo: 2,
    proposalKind: 'homecare', isSales: true, priorityClass: 1, hardCondition: { '==': [1, 1] },
    softFeatures: { weights: {} }, baseScript: 'base', cooldownVisits: 2, lifecycleStatus: 'active', version: 1,
    ...overrides,
  };
}

describe('generateHomeCareNote', () => {
  it('proposalKind=homecareの場合、実候補コードを含む注記を返す(架空の商品名は含まない)', () => {
    const note = generateHomeCareNote(candidate({ code: 'A1-step2' }));
    expect(note).toContain('A1-step2');
    expect(note).toContain('1点まで');
  });

  it('proposalKind=homecare以外はnull', () => {
    expect(generateHomeCareNote(candidate({ proposalKind: 'upsell' }))).toBeNull();
    expect(generateHomeCareNote(candidate({ proposalKind: 'subscription' }))).toBeNull();
  });
});
