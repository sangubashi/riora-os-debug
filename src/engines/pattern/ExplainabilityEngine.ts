/**
 * ExplainabilityEngine.ts — 提案根拠の説明文生成(決定論・LLM不使用)
 *
 * 設計根拠:
 *   - docs/ai/Riora_Proposal_Generator_Architecture_v2.0.md §7
 *     (⑧ExplainabilityEngine: 決定論・テンプレート文・LLM不使用。説明は
 *      スタッフ/マネージャー向けのみ・顧客には見せない)
 *   - docs/ai/Riora_SuccessPattern_Final_Architecture_v1.0.md §8(Q1/Q2/Q3形式)
 *
 * ProposalOrchestrator.ts冒頭コメントで「現状はnull/固定文言」とされていた
 * 欠落部分を実装する。**文言テンプレートはあるが、埋め込む値はすべて実際の
 * ScoredCandidate/Resolution(本番のFireScore内訳・実候補コード・実件数)であり、
 * 固定の説明文(入力に関わらず同一の文章)にはならない**(禁止: 固定テンプレ)。
 */
import type { ScoreBreakdown, ScoredCandidate, Resolution, ExplainTexts, RejectedCandidate } from '../../types/riora.types';

const BREAKDOWN_LABEL: Record<keyof ScoreBreakdown, string> = {
  successRate: '過去の成功率',
  contextFit: '現在の状況との適合度',
  timing: 'タイミングの良さ',
  affinity: 'スタッフとの相性',
  urgency: '優先度',
  overrideBoost: '手動指定による加点',
  churnPenalty: '離脱リスクによる減点',
};

const BLOCKED_LABEL: Record<RejectedCandidate['blockedBy'], string> = {
  lifecycle: 'パターンが現在無効/テスト対象外のため',
  condition: '発火条件を満たさなかったため',
  'G-SUB': 'サブスク提案の4条件が揃っていないため',
  'G-CHURN': '離脱リスクが高く販売系提案を出せないため',
  'G-COOL': '直近で同種の提案を行ったため(クールダウン中)',
  'G-FREQ': '本来店での提案件数上限に達したため',
  'G-CONSENT': 'DM配信の同意が無いため',
  exclusion: '同時に成立しない組み合わせのため',
  score: 'スコアが他候補より低かったため',
  slot: '提案枠が他候補で埋まったため',
};

/**
 * breakdownのうち寄与が最大の項目を返す(decisiveFactor=採用理由の決定打)。
 * churnPenalty/overrideBoostはPatternScorer.tsで加点要素(0-X点)ではなく乗算修飾子
 * (fireScore = 100 * base * overrideBoost * churnPenalty・既定値1.0)として扱われており、
 * successRate等の加点要素と同一スケールで比較できない。overrideBoostは既定値1.0(無補正)の
 * 場合は対象外とし、実際に補正が掛かっている場合(O1手動指定等)のみ決定打として残す。
 */
function topBreakdownFactor(breakdown: ScoreBreakdown): { key: keyof ScoreBreakdown; value: number } {
  const entries = Object.entries(breakdown) as [keyof ScoreBreakdown, number][];
  const positive = entries.filter(([key, value]) => {
    if (key === 'churnPenalty') return false;
    if (key === 'overrideBoost') return value !== 1;
    return true;
  });
  if (positive.length === 0) {
    // overrideBoostが無補正(1.0)でも他に加点要素が無いという事態は起きない
    // (successRate等は常に存在する)が、型上の安全のためフォールバックを置く。
    return { key: 'successRate', value: breakdown.successRate };
  }
  return positive.reduce((best, cur) => (cur[1] > best.value ? { key: cur[0], value: cur[1] } : best), { key: positive[0][0], value: positive[0][1] });
}

/** 採用候補のdecisiveFactor文字列(real breakdown値・FiredProposal.decisiveFactorに格納する)。 */
export function computeDecisiveFactor(sc: ScoredCandidate): string {
  const top = topBreakdownFactor(sc.breakdown);
  return `${BREAKDOWN_LABEL[top.key]}(寄与${top.value.toFixed(1)}点)`;
}

export interface ExplainInput {
  mandatory: ScoredCandidate | null;
  secondary: ScoredCandidate | null;
  resolution: Resolution;
}

/** Resolutionから実データを使ったExplainTextsを構築する(決定論・LLM不使用)。 */
export function explainResolution(input: ExplainInput): ExplainTexts {
  const { mandatory, resolution } = input;

  if (!mandatory) {
    return {
      staffLine1: '本日、発火条件を満たす提案はありません。',
      staffAvoid: null,
      managerQ1: '候補はいずれも発火条件・Hardゲートを通過しませんでした。',
      managerQ2: resolution.rejected.length > 0
        ? `見送った候補: ${resolution.rejected.map((r) => `${r.candidate.code}(${BLOCKED_LABEL[r.blockedBy]})`).join(' / ')}`
        : '候補自体がありませんでした。',
      managerQ3: '該当なし。',
    };
  }

  const decisive = computeDecisiveFactor(mandatory);
  const staffLine1 = `${mandatory.candidate.code}(${mandatory.candidate.proposalKind})を提案します。${decisive}・FireScore ${Math.round(mandatory.fireScore)}点。`;

  const staffAvoid = mandatory.candidate.isSales
    ? '販売提案は本日1件までです。重ねて勧めないでください。'
    : null;

  const managerQ1 = `${mandatory.candidate.code}が発火しました。${decisive}が決定打で、FireScore ${Math.round(mandatory.fireScore)}点(内訳: 成功率${mandatory.breakdown.successRate.toFixed(1)}/適合度${mandatory.breakdown.contextFit.toFixed(1)}/タイミング${mandatory.breakdown.timing.toFixed(1)}/相性${mandatory.breakdown.affinity.toFixed(1)}/優先度${mandatory.breakdown.urgency.toFixed(1)})でした。`;

  const otherRejected = resolution.rejected.filter((r) => r.candidate.code !== mandatory.candidate.code);
  const managerQ2 = otherRejected.length > 0
    ? `他候補は: ${otherRejected.map((r) => `${r.candidate.code}(${BLOCKED_LABEL[r.blockedBy]})`).join(' / ')}`
    : '他に競合する候補はありませんでした。';

  const managerQ3 = `${decisive}が${mandatory.candidate.code}を最終的に選んだ決定打です。`;

  return { staffLine1, staffAvoid, managerQ1, managerQ2, managerQ3 };
}
