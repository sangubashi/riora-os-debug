/**
 * NextActionGenerator.ts — 次回来店候補日の算出(決定論・LLM不使用)
 *
 * 設計根拠: docs/ai/Riora_Proposal_Generator_Architecture_v2.0.md §4
 *   「candidateDateの算出式: last_visit_date + round(avg_cycle)」
 *
 * ProposalOrchestrator.ts冒頭コメントで「現状はnull」とされていた欠落部分の
 * 最小実装。E型(ブライダル)の逆算スケジューリングやドリフト引き戻しロジック
 * (v2.0 §4の精密仕様)は本Stepでは実装せず、基本式のみを実データで算出する
 * (架空の日付を作らない・実データ(lastVisitDate/avgCycle)が無ければnullを返す)。
 */
import type { PatternContext } from '../../types/riora.types';

/** rebooking系の提案のみ次回候補日を算出する(他のproposalKindはnull)。 */
export function computeCandidateDate(ctx: PatternContext, proposalKind: string | null): string | null {
  if (proposalKind !== 'rebooking') return null;
  if (!ctx.raw.lastVisitDate || ctx.avgCycle <= 0) return null;

  const last = new Date(`${ctx.raw.lastVisitDate}T00:00:00Z`);
  const candidate = new Date(last.getTime() + Math.round(ctx.avgCycle) * 86_400_000);
  return candidate.toISOString().slice(0, 10);
}
