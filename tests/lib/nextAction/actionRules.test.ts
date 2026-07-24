import { describe, expect, it } from 'vitest';
import { ACTION_RULES, type ActionRuleInput } from '../../../src/lib/nextAction/actionRules';
import type { MatchReason } from '../../../src/lib/nextAction/knowledgeMatch';

const BASE_INPUT: ActionRuleInput = {
  customerId: 'c1',
  visits: 1,
  totalSales: 0,
  lineResponseRate: 0,
  vipRank: 0,
  churnRisk: 0,
  daysSinceLastVisit: 0,
  recommendedCycleDays: 30,
  skinTags: ['乾燥'],
  insightTags: [],
  hasRecentPurchase: false,
  recentActionTypes: [],
  matchedKnowledgeReasons: [],
};

describe('product_skin_tag rule — PHASE2-C-2 生成理由(matchedKnowledgeReasons)連携', () => {
  const rule = ACTION_RULES.find(r => r.id === 'product_skin_tag')!;

  it('matchedKnowledgeReasonsが空の場合はreasonsも空になる', () => {
    expect(rule.reasons?.(BASE_INPUT)).toEqual([]);
  });

  it('matchedKnowledgeReasonsのlabelだけを取り出してreasonsとして返す(scoreは画面に出さない)', () => {
    const knowledgeReasons: MatchReason[] = [
      { type: 'skin_tag_match', score: 30, label: '乾燥タグ一致' },
      { type: 'category_match', score: 25, label: '美容液系カテゴリ一致' },
      { type: 'purchase_history_match', score: 15, label: '購入履歴一致' },
    ];
    const reasons = rule.reasons?.({ ...BASE_INPUT, matchedKnowledgeReasons: knowledgeReasons });
    expect(reasons).toEqual(['乾燥タグ一致', '美容液系カテゴリ一致', '購入履歴一致']);
  });

  it('matchが成立する条件は従来通り変化しない(skinTagsあり・直近購入なし・提案未実施)', () => {
    expect(rule.match(BASE_INPUT)).toBe(true);
  });
});
