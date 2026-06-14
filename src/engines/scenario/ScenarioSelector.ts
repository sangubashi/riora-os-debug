// ================================================================
// ScenarioSelector (Scenario Engine Step2-2)
//
// 責務: Pattern Engineから渡されたproposal(顧客情報+判定基準時刻)と、
// brain_scenarios候補群(ScenarioCandidateRow[])を受け取り、5段階の
// 選定ルールで最適な1件(SelectedScenario)を選ぶ純粋関数。
//
// 選定ルール(順序固定・各段は「絞り込み」。絞り込んだ結果が空集合に
// なる場合は絞り込みを適用しない=直前の集合をそのまま次段へ渡す):
//   Step1 suppression: lastSentAtがnowJstから7日以内 -> 除外
//                       (全滅した場合はnullを返す=今回は送らない)
//   Step2 priority   : critical > high > medium > low の中で最高位のみ残す
//   Step3 customer_type: proposal.customerTypeと一致する候補があれば
//                       一致するものだけに絞る(無ければ絞らない)
//   Step4 channel    : channel='LINE'の候補があればLINEのみに絞る
//                       (無ければ絞らない)
//   Step5 tie break  : updatedAt降順(DESC)で先頭の1件を採用
//
// brain_scenariosは本実装時点で未作成のテーブルのため、ScenarioCandidateRow/
// SelectedScenarioはこのファイル内で定義する自己完結型とする(Step1の
// ScenarioCandidate/ScenarioContext(core/ScenarioContext.ts)とは別物)。
// customerTypeはriora.types.tsのCustomerType('A_acne'|'B_pore'|'C_sensitive'|
// 'D_aging'|'E_bridal')を再利用する(先頭文字がA-Eに対応)。
//
// エラー処理: 例外を投げない(total function)。入力不整合等で例外が
// 発生した場合はScenarioSelectorDegradedResultへ正規化する。
// riora.types.tsのEngineDegradedResultはproposal: FinalProposalSet
// (in_store Pattern Engine専用)に固定されており本Selectorの戻り値とは
// 形が合わないため、同じ{degraded:true, reason}規約に倣った専用の
// 最小型をこのファイルで定義する。
//
// 注記: docs/architecture/Riora_ScenarioEngine_Code_Architecture_v1.0.md
// §6にも"ScenarioSelector"(match -> resolve -> build のpureオーケストレータ)
// が定義されているが、本タスクで指定された選定ロジックは別物。クラス名の
// 重複は将来の統合時に名称調整が必要(本Stepでは指示通りこの名前で実装)。
//
// 依存規則: Supabase importを行わない。Pattern Engine同様、engines/配下では
// snake_case<->camelCase変換は行わない(呼出側/リポジトリ層の責務)。
// ================================================================

import type { CustomerType, UUID } from '../../types/riora.types';

export type ScenarioPriority = 'critical' | 'high' | 'medium' | 'low';
export type ScenarioChannel = 'LINE' | 'SMS' | 'EMAIL';
export type ISODateTime = string;

/** brain_scenarios候補群の1行(camelCase表現)。 */
export interface ScenarioCandidateRow {
  scenarioCode: string;
  priority: ScenarioPriority;
  customerType: CustomerType;
  channel: ScenarioChannel;
  updatedAt: ISODateTime;
  /** 同一scenarioの直近送信日時。未送信はnull(Step1 suppression判定に使用)。 */
  lastSentAt: ISODateTime | null;
}

/** Pattern Engineから渡されるproposal(本Selectorの判定基準)。 */
export interface ScenarioSelectionProposal {
  customerId: UUID;
  customerType: CustomerType; // Step3の適合判定基準
  nowJst: ISODateTime; // Step1のsuppression判定基準時刻
}

export interface ScenarioSelectorInput {
  proposal: ScenarioSelectionProposal;
  candidates: ScenarioCandidateRow[];
}

/** 選定結果。 */
export interface SelectedScenario {
  scenarioCode: string;
  priority: ScenarioPriority;
  customerType: CustomerType;
  channel: ScenarioChannel;
  updatedAt: ISODateTime;
}

/** §9エラー処理規約(throwしない)に倣った本Selector専用のDegraded結果。 */
export interface ScenarioSelectorDegradedResult {
  degraded: true;
  reason: string;
  selected: null;
}

const PRIORITY_RANK: Record<ScenarioPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const SUPPRESSION_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function isSuppressed(candidate: ScenarioCandidateRow, nowJst: ISODateTime): boolean {
  if (candidate.lastSentAt === null) return false;
  const elapsedMs = new Date(nowJst).getTime() - new Date(candidate.lastSentAt).getTime();
  return elapsedMs <= SUPPRESSION_DAYS * MS_PER_DAY;
}

/** 集合をpredicateで絞り込む。絞り込み結果が空ならfilteredではなくpoolをそのまま返す(段の無効化)。 */
function narrowOrKeep(pool: ScenarioCandidateRow[], predicate: (c: ScenarioCandidateRow) => boolean): ScenarioCandidateRow[] {
  const filtered = pool.filter(predicate);
  return filtered.length > 0 ? filtered : pool;
}

function toSelected(c: ScenarioCandidateRow): SelectedScenario {
  return {
    scenarioCode: c.scenarioCode,
    priority: c.priority,
    customerType: c.customerType,
    channel: c.channel,
    updatedAt: c.updatedAt,
  };
}

export class ScenarioSelector {
  select(input: ScenarioSelectorInput): SelectedScenario | null | ScenarioSelectorDegradedResult {
    try {
      const { proposal, candidates } = input;

      // Step1: suppression(7日以内同一scenario送信済みを除外。全滅ならnull)
      let pool = candidates.filter((c) => !isSuppressed(c, proposal.nowJst));
      if (pool.length === 0) return null;

      // Step2: priority順(critical > high > medium > low)の最上位のみ残す
      const topRank = Math.min(...pool.map((c) => PRIORITY_RANK[c.priority]));
      pool = pool.filter((c) => PRIORITY_RANK[c.priority] === topRank);

      // Step3: customer_type一致を優先(一致が無ければ絞らない)
      pool = narrowOrKeep(pool, (c) => c.customerType === proposal.customerType);

      // Step4: channel='LINE'を優先(LINEが無ければ絞らない)
      pool = narrowOrKeep(pool, (c) => c.channel === 'LINE');

      // Step5: updated_at DESCで最終Tie Break
      const winner = [...pool].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];

      return toSelected(winner);
    } catch (e) {
      return { degraded: true, reason: e instanceof Error ? e.message : 'unknown error', selected: null };
    }
  }
}
