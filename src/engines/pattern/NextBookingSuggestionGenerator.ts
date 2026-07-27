/**
 * NextBookingSuggestionGenerator.ts — 次回予約おすすめの自然文生成(決定論・LLM不使用)
 *
 * 既存のavgCycle/lastVisitDate(PatternContextBuilder算出済み・実データ)をそのまま
 * 用いて週単位のおすすめ表現とトーク例を1行組み立てる。NextActionGenerator.computeCandidateDate
 * (proposalKind==='rebooking'限定)とは独立させ、ホームケア提案が主提案の日にも
 * 常に表示できるようにする(架空の周期は作らない・実データが無ければnullを返す)。
 */
import type { PatternContext } from '../../types/riora.types';

export interface NextBookingSuggestion {
  rangeText:    string; // 例: "3〜4週間後"
  talkExample:  string; // 例: "この状態を維持するなら3週間後くらいがおすすめです。"
}

export function generateNextBookingSuggestion(ctx: PatternContext): NextBookingSuggestion | null {
  if (!ctx.raw.lastVisitDate || ctx.avgCycle <= 0) return null;

  const weeksLow  = Math.max(1, Math.floor(ctx.avgCycle / 7));
  const weeksHigh = Math.max(weeksLow, Math.ceil(ctx.avgCycle / 7));
  const rangeText = weeksLow === weeksHigh ? `${weeksLow}週間後` : `${weeksLow}〜${weeksHigh}週間後`;
  const talkWeeks = Math.max(1, Math.round(ctx.avgCycle / 7));

  return {
    rangeText,
    talkExample: `この状態を維持するなら${talkWeeks}週間後くらいがおすすめです。`,
  };
}
