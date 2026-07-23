// ================================================================
// ProposalOrchestrator (Pattern Engine Code Architecture v1.0 §8
// "ProposalGenerator" / Proposal Generator v2.0 §2)
//
// DIで束ねる核心パイプライン(Step6-9で実装済のエンジンのみ):
//   resolveAffinity -> (applyTimingOffset -> match) -> loadCells
//   -> score -> resolve -> FinalProposalSet整形
//
// 範囲外(本Stepでは未実装・呼出側/将来Stepの責務としてコメントで明示):
//   - resolveAssignment(パターン切替ヒステリシス)はPatternProgress永続化を伴う
//     別関心事のため、本Orchestratorでは呼ばない。呼出側がdeps.resolver.
//     resolveAssignment()を直接呼んで割当パターンを決定し、その
//     patternId(UUID)→candidates(patternCode/stepNoでの絞込み)へのマッピングは
//     CandidateRepo/PatternContextBuilder層の責務として残す(候補集合
//     candidatesは呼出側で既に絞込済のものを渡す想定)。
//   - PatternContextBuilder(ContextBundle -> PatternContext)は
//     src/engines/pattern/PatternContextBuilder.tsに実装済(AI提案本物化タスク)。
//     呼出側(API層)がContextBundleからPatternContextを組み立てて渡す。
//   - ScriptComposer(adjustedScriptのstyle別合成。現状はbaseScriptを暫定使用)
//   - ExplainabilityEngine.ts/NextActionGenerator.tsは実装済(AI提案本物化タスク)
//     であり、本ファイルのtoFiredProposal()・generateFinalProposalSet()から
//     呼び出す(decisiveFactor/explanation/candidateDateは実データで算出する。
//     固定文言ではない・該当データが無い場合のみ正直に「提案なし」を返す)。
//   - LineScenarioConnector(dm重複排除・Pin停止。現状はresolution.dmを
//     最小限のQueuedScenarioへ素通し)
//
// エラー処理(§11): resolver.resolveの不変条件違反やRepo throwはここでcatchし、
// EngineDegradedResultへ正規化する(throwを外に漏らさない)。
// ================================================================

import type { IStatsRepo } from '../../repositories/interfaces';
import type {
  AffinityResolved,
  Candidate,
  CellKey,
  EngineDegradedResult,
  ExplainTexts,
  FinalProposalSet,
  FiredProposal,
  OutcomeLite,
  Overrides,
  PatternContext,
  QueuedScenario,
  ScoredCandidate,
  ScoringWeights,
  Staff,
  StaffAdjustment,
} from '../../types/riora.types';
import type { StyleAffinityTable } from '../../types/brain.types';
import { ConflictResolver } from './ConflictResolver';
import { PatternMatcher } from './PatternMatcher';
import { PatternScorer } from './PatternScorer';
import { StaffAdjustmentEngine } from './StaffAdjustmentEngine';
import { computeDecisiveFactor, explainResolution } from './ExplainabilityEngine';
import { computeCandidateDate } from './NextActionGenerator';

export interface GeneratorDeps {
  statsRepo: IStatsRepo;
  matcher: PatternMatcher;
  scorer: PatternScorer;
  resolver: ConflictResolver;
  staffAdjust: StaffAdjustmentEngine;
}

export interface GenerateInput {
  ctx: PatternContext;
  candidates: Candidate[];
  staff: Staff;
  adjustments: StaffAdjustment[];
  weights: ScoringWeights;
  styleAffinity: StyleAffinityTable;
  overrides: Overrides;
  recentOutcomes: OutcomeLite[];
  consentDm: boolean;
  nowJst: string;
}

/** ExplainabilityEngine未実装のためのフォールバック定型文(§11準拠: 説明欠損で提案を止めない)。 */
const FALLBACK_EXPLAIN_TEXTS: ExplainTexts = {
  staffLine1: '',
  staffAvoid: null,
  managerQ1: '',
  managerQ2: '',
  managerQ3: '',
};

/** ScenarioConnector(Step2-4)等、他EngineのEngineDegradedResult組立からも再利用する空提案。 */
export function emptyFinalProposalSet(): FinalProposalSet {
  return {
    inStore: { mandatory: null, secondary: null, candidateDate: null },
    dm: null,
    explanation: FALLBACK_EXPLAIN_TEXTS,
    decisionRecordId: null,
  };
}

/** ScoredCandidate -> FiredProposal。adjustedScript(style別合成)はScriptComposer範囲外のため暫定値。 */
function toFiredProposal(
  sc: ScoredCandidate,
  ctx: PatternContext,
  affinity: AffinityResolved,
  staffAdjust: StaffAdjustmentEngine,
  isMandatory: boolean
): FiredProposal {
  const { scriptStyle } = staffAdjust.applyOutputStyle(sc, affinity);
  return {
    customerId: ctx.customerId,
    candidateCode: sc.candidate.code,
    patternId: sc.candidate.patternCode ?? '',
    stepNo: sc.candidate.stepNo ?? 0,
    proposalKind: sc.candidate.proposalKind,
    baseScript: sc.candidate.baseScript,
    adjustedScript: sc.candidate.baseScript,
    scriptStyle,
    priority: sc.candidate.priorityClass,
    isMandatory,
    fireScore: sc.fireScore,
    decisiveFactor: computeDecisiveFactor(sc),
  };
}

function toQueuedScenario(sc: ScoredCandidate, ctx: PatternContext): QueuedScenario {
  return {
    scenarioId: sc.candidate.code,
    customerId: ctx.customerId,
    proposalKind: sc.candidate.proposalKind,
    status: 'pending',
  };
}

export class ProposalOrchestrator {
  constructor(private readonly deps: GeneratorDeps) {}

  async generateFinalProposalSet(input: GenerateInput): Promise<FinalProposalSet | EngineDegradedResult> {
    try {
      const { ctx, candidates, staff, adjustments, weights, styleAffinity, overrides, recentOutcomes, consentDm, nowJst } = input;

      // 1. StaffAffinity解決(採点中w4 + 出力時style/constraints)
      const affinity = this.deps.staffAdjust.resolveAffinity(staff, adjustments, styleAffinity);

      // 1.5. customer_type一致フィルタ(Phase 1-Ea): パターンのcustomer_typeが
      // 顧客のcustomer_typeと異なる候補は評価対象から除外する。candidate.customerTypeが
      // null(旧データ等)の場合は既存互換維持のためフィルタしない。
      const typeFiltered = candidates.filter((c) => c.customerType == null || c.customerType === ctx.customerType);

      // 2-3. 候補ごとにtiming_offset仮context -> Hard判定
      const tempCtxByUid = new Map<string, PatternContext>();
      const eligible: Candidate[] = [];
      for (const c of typeFiltered) {
        const tempCtx = this.deps.staffAdjust.applyTimingOffset(ctx, c, affinity);
        tempCtxByUid.set(c.uid, tempCtx);

        const mr = this.deps.matcher.match({ candidates: [c], ctx: tempCtx, recentOutcomes, consentDm, nowJst });
        eligible.push(...mr.eligible);
      }

      // 4. eligibleセルのみ統計取得(IN句1クエリ)
      const cellKeys = eligible.map((c) => `${c.code}:${ctx.customerType}:${affinity.style}` as CellKey);
      const stats = await this.deps.statsRepo.loadCells(cellKeys);

      // 5. 採点(候補ごとのtiming_offset仮contextで)
      const scored: ScoredCandidate[] = [];
      for (const c of eligible) {
        scored.push(...this.deps.scorer.score([c], tempCtxByUid.get(c.uid) ?? ctx, stats, weights, affinity, overrides));
      }

      // 6. 枠詰め+タイブレーク+不変条件
      const resolution = this.deps.resolver.resolve(scored, ctx, stats, affinity, overrides);

      const mandatory = resolution.inStore.mandatory
        ? toFiredProposal(resolution.inStore.mandatory, ctx, affinity, this.deps.staffAdjust, true)
        : null;
      const secondary = resolution.inStore.secondary
        ? toFiredProposal(resolution.inStore.secondary, ctx, affinity, this.deps.staffAdjust, false)
        : null;

      // 7. 出力契約(v2.0 §2)へ整形。explanation/candidateDateは実データ
      // (ScoredCandidate内訳・実候補コード)から決定論的に算出する(固定文言ではない)。
      return {
        inStore: {
          mandatory,
          secondary,
          candidateDate: computeCandidateDate(ctx, mandatory?.proposalKind ?? null),
        },
        dm: resolution.dm ? toQueuedScenario(resolution.dm, ctx) : null,
        explanation: explainResolution({ mandatory: resolution.inStore.mandatory, secondary: resolution.inStore.secondary, resolution }),
        decisionRecordId: null,
      };
    } catch (e) {
      return {
        degraded: true,
        reason: e instanceof Error ? e.message : 'unknown error',
        proposal: emptyFinalProposalSet(),
      };
    }
  }
}
