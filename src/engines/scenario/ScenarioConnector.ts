// ================================================================
// ScenarioConnector (Scenario Engine Step2-4)
//
// 責務: ProposalOrchestrator(Pattern Engine)の出力(ProposalResult)を
// 受け取り、ScenarioSelector(Step2-2) -> ScenarioQueueBuilder(Step2-3)
// の順に接続して1件分のScenarioResultを組み立てる、薄い接続層。
//
// 入力: ProposalResult = FinalProposalSet | EngineDegradedResult
//       (ProposalOrchestrator.generateFinalProposalSet()のawait結果そのもの)
// 出力: ScenarioResult | EngineDegradedResult
//
// 処理順序:
//   1. proposalResultが既にdegraded(ProposalOrchestrator側で失敗済み)の
//      場合はScenario側の処理を行わずそのまま伝播する(処理短絡)。
//   2. ScenarioSelector.select({proposal, candidates})
//      - null         -> 該当シナリオなし(suppression全滅/候補0件等)。
//                         正常系としてScenarioResult{selected:null, queued:null}
//      - degraded結果 -> ScenarioSelectorDegradedResultをEngineDegradedResultへ正規化
//      - SelectedScenario -> 3へ
//   3. ScenarioQueueBuilder.build({selected, customerId, storeId, templateId, scheduledAt})
//      -> ScenarioResult{selected, queued: LineSendQueuePayload}
//
// FinalProposalSet(v2.0 §2)自体にはcustomerType/nowJst/storeId/templateId/
// scheduledAtに相当する情報が無いため、これらはScenarioSelector/
// ScenarioQueueBuilderの入力としてConnectorのInputに別途渡す
// (呼出側=Repository層が、ProposalOrchestratorの結果と合わせて保持する値)。
//
// 例外禁止: 全体をtry/catchし、想定外の例外もEngineDegradedResultへ
// 正規化する(emptyFinalProposalSetはProposalOrchestratorと共用)。
// 純粋関数。Supabase importを行わない。
// ================================================================

import { emptyFinalProposalSet } from '../pattern/ProposalOrchestrator';
import type { EngineDegradedResult, FinalProposalSet, UUID } from '../../types/riora.types';
import { ScenarioQueueBuilder, type LineSendQueuePayload } from './ScenarioQueueBuilder';
import {
  ScenarioSelector,
  type ISODateTime,
  type ScenarioCandidateRow,
  type ScenarioSelectionProposal,
  type SelectedScenario,
} from './ScenarioSelector';

/** ProposalOrchestrator.generateFinalProposalSet()のawait結果(本Connectorの入力)。 */
export type ProposalResult = FinalProposalSet | EngineDegradedResult;

/** ScenarioConnectorの正常出力。selected/queuedが共にnullなら「今回は送らない」を表す。 */
export interface ScenarioResult {
  selected: SelectedScenario | null;
  queued: LineSendQueuePayload | null;
}

export interface ScenarioConnectInput {
  proposalResult: ProposalResult;
  selectionProposal: ScenarioSelectionProposal;
  candidates: ScenarioCandidateRow[];
  storeId: UUID;
  templateId: string;
  scheduledAt: ISODateTime;
}

export interface ScenarioConnectorDeps {
  selector: ScenarioSelector;
  queueBuilder: ScenarioQueueBuilder;
}

function isDegradedProposal(r: ProposalResult): r is EngineDegradedResult {
  return 'degraded' in r && r.degraded === true;
}

export class ScenarioConnector {
  constructor(private readonly deps: ScenarioConnectorDeps) {}

  connect(input: ScenarioConnectInput): ScenarioResult | EngineDegradedResult {
    try {
      const { proposalResult, selectionProposal, candidates, storeId, templateId, scheduledAt } = input;

      // 1. ProposalOrchestrator側で既に失敗 -> 短絡してそのまま伝播
      if (isDegradedProposal(proposalResult)) {
        return proposalResult;
      }

      // 2. ScenarioSelector(Step2-2)
      const selection = this.deps.selector.select({ proposal: selectionProposal, candidates });

      if (selection === null) {
        return { selected: null, queued: null };
      }
      if ('degraded' in selection) {
        return { degraded: true, reason: selection.reason, proposal: emptyFinalProposalSet() };
      }

      // 3. ScenarioQueueBuilder(Step2-3)
      const queued = this.deps.queueBuilder.build({
        selected: selection,
        customerId: selectionProposal.customerId,
        storeId,
        templateId,
        scheduledAt,
      });

      return { selected: selection, queued };
    } catch (e) {
      return { degraded: true, reason: e instanceof Error ? e.message : 'unknown error', proposal: emptyFinalProposalSet() };
    }
  }
}
