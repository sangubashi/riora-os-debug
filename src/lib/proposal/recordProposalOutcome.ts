/**
 * recordProposalOutcome.ts — brain_proposal_outcomesへの記録(Phase 1-Bc / 1-Cb)
 *
 * fire_log(brain_pattern_fire_log)とvisit(brain_visits)にはvisit_idによる
 * 直接の紐付けが無いため(Phase 1-Bb調査で確認済み)、customer_id + 時刻近傍で
 * 逆引きする。Phase 1-Bb実データ検証(誤紐付けリスク推定)の結論を踏まえた設計:
 *   - customer_id一致 かつ fire_log.created_at <= 基準時刻 のうち最新1件を候補とする
 *   - 候補との時間差が30日を超える場合は採用しない(明らかに無関係なfire_logを拾わない)
 *
 * was_executed/was_accepted/amountの判定(Phase 1-Cb): proposal_kind='homecare'の
 * みvisit.retailAmount(CSV会計データのagg.retailSales由来)で実行結果を判定する
 * (Phase 1-C調査の結論通り、homecareは既存homecarePurchasedロジックと同じ根拠を
 * 使えるため最も信頼できる)。homecare以外(upsell/subscription/pack/rebooking)は
 * 判定材料が不十分・データソースが非同期(Phase 1-C調査参照)なため、Phase 1-Bcと
 * 同じ安全側固定値(false/false/0)のまま据え置く。
 *
 * 呼び出し元(csvImportPipeline.ts)がvisitRepo.reconcile()/createSequenced()成功
 * 直後に呼ぶ前提のため、Visit型が公開していないcreated_atの代わりに「今」を
 * visit確定時刻の近似値として使う。
 */
import type { IBriefingRepo, IOutcomeRepo } from '../../repositories/interfaces';
import type { CustomerType, ProposalKind, StaffStyle, Visit } from '../../types/riora.types';

const MATCH_WINDOW_DAYS = 30;
/** customer単位でfire_log逆引き候補として見る直近件数の上限(全件走査を避けるため)。 */
const RECENT_FIRE_LOG_LOOKBACK = 20;

/**
 * Phase 1-Ba(decision_record構造化保存)で追加されたフィールドの読み取り用型。
 * BriefingEntry.decisionRecordの公称型(DecisionRecord)には含まれないため、
 * ここでのみ緩く型付けして読み出す(DB/型定義自体は変更しない)。
 */
interface FireLogDecisionRecordShape {
  degraded?: boolean;
  patternId?: string | null;
  stepNo?: number | null;
  proposalKind?: string | null;
  scriptStyle?: string | null;
  contextSnapshot?: { customerType?: string | null };
}

export interface RecordProposalOutcomeRepos {
  briefingRepo: IBriefingRepo;
  outcomeRepo: IOutcomeRepo;
}

export interface RecordProposalOutcomeInput {
  storeId: string;
  visit: Visit;
}

export type RecordProposalOutcomeResult =
  | { recorded: true; outcomeId: string; ambiguousCandidateCount: number }
  | { recorded: false; reason: 'no_eligible_fire_log' | 'outside_match_window' | 'incomplete_fire_log_data' };

export async function recordProposalOutcome(
  input: RecordProposalOutcomeInput,
  repos: RecordProposalOutcomeRepos
): Promise<RecordProposalOutcomeResult> {
  const { visit, storeId } = input;
  const referenceTime = Date.now();

  const recent = await repos.briefingRepo.recentByCustomer(visit.customerId, RECENT_FIRE_LOG_LOOKBACK);

  const eligible = recent.filter((entry) => {
    const dr = entry.decisionRecord as unknown as FireLogDecisionRecordShape;
    if (dr.degraded) return false;
    if (!dr.patternId || dr.stepNo == null || !dr.proposalKind || !dr.scriptStyle) return false;
    return new Date(entry.createdAt).getTime() <= referenceTime;
  });

  if (eligible.length === 0) return { recorded: false, reason: 'no_eligible_fire_log' };

  const chosen = eligible.reduce((a, b) => (new Date(a.createdAt) > new Date(b.createdAt) ? a : b));
  const gapDays = (referenceTime - new Date(chosen.createdAt).getTime()) / 86_400_000;
  if (gapDays > MATCH_WINDOW_DAYS) return { recorded: false, reason: 'outside_match_window' };

  const dr = chosen.decisionRecord as unknown as FireLogDecisionRecordShape;
  const customerType = dr.contextSnapshot?.customerType;
  if (!dr.patternId || dr.stepNo == null || !dr.proposalKind || !dr.scriptStyle || !customerType) {
    return { recorded: false, reason: 'incomplete_fire_log_data' };
  }

  // あいまい共有の検出(Phase 1-Bb §3参照): この顧客に採用可能な候補が複数あるほど、
  // 「本当にこのvisitに対応するfire_logか」の確度は下がる。判定結果には反映せず
  // (候補数によらず同じ判定ロジックを適用する)、呼び出し元への参考情報としてのみ返す。
  const ambiguousCandidateCount = eligible.length;

  // Phase 1-Cb: homecareのみ、この来店で実際に店販(ホームケア商品)が売上に計上されたか
  // (visit.retailAmount、CSV会計データのagg.retailSales由来)で実行結果を判定する。
  // homecare以外(upsell/subscription/pack/rebooking)はPhase 1-Bcのまま安全側固定値。
  const proposalKind = dr.proposalKind as ProposalKind;
  const isHomecare = proposalKind === 'homecare';
  const wasExecuted = isHomecare && visit.retailAmount > 0;
  const wasAccepted = isHomecare && visit.retailAmount > 0;
  const amount = isHomecare ? visit.retailAmount : 0;

  const created = await repos.outcomeRepo.create({
    storeId,
    customerId: visit.customerId,
    visitId: visit.id,
    staffId: visit.staffId,
    patternId: dr.patternId,
    stepNo: dr.stepNo,
    proposalKind,
    visitCountAt: visit.visitCountAt,
    wasBriefed: true,
    wasExecuted,
    wasAccepted,
    amount,
    customerType: customerType as CustomerType,
    staffStyle: dr.scriptStyle as StaffStyle,
  });

  return { recorded: true, outcomeId: created.id, ambiguousCandidateCount };
}
