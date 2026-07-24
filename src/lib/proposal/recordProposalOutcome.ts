/**
 * recordProposalOutcome.ts — brain_proposal_outcomesへの記録(Phase 1-Bc / 1-Cb / 1-Da / 1-Db / 1-Dd)
 *
 * fire_log(brain_pattern_fire_log)とvisit(brain_visits)にはvisit_idによる
 * 直接の紐付けが無いため(Phase 1-Bb調査で確認済み)、customer_id + 時刻近傍で
 * 逆引きする。Phase 1-Bb実データ検証(誤紐付けリスク推定)の結論を踏まえた設計:
 *   - customer_id一致 かつ fire_log.created_at <= 基準時刻 のうち最新1件を候補とする
 *   - 候補との時間差が30日を超える場合は採用しない(明らかに無関係なfire_logを拾わない)
 *
 * was_executed/was_accepted/amountの判定:
 *   - homecare(Phase 1-Cb): visit.retailAmount(CSV会計データのagg.retailSales由来)で
 *     判定する(Phase 1-C調査の結論通り、既存homecarePurchasedロジックと同じ根拠を
 *     使えるため最も信頼できる)。
 *   - upsell(Phase 1-Da): 呼び出し元(csvImportPipeline.ts)がCSV取込時点でしか
 *     分からない agg.optionNames.length > 0 を hasOptionPurchase として渡し、これで
 *     判定する。amountは正確な金額を個別集計する手段が無いため(Phase 1-C調査の
 *     結論通り、salonBoardDetailParser.tsはオプション行の金額を合算していない)、
 *     暫定的に0固定とする。
 *   - subscription(Phase 1-Db): 呼び出し元がCSV取込時点のagg.menuName/serviceNames/
 *     retailNamesに"サブスク"という文字列を含むかを hasSubscriptionKeyword として渡し、
 *     これで判定する(Phase 1-C調査の結論通り、構造化列が存在しないためキーワード
 *     マッチのみ。表記ゆれは拾えない既知の制約)。amountは同じ理由で暫定的に0固定。
 *   - rebooking(Phase 1-Dd): visit.nextBookingMade(brain_visits.next_booking_made)で
 *     判定する。この列はCSV取込のreconcile()が更新対象に含めていないフィールドのため、
 *     既存visit(source='staff_input')がスタッフの接客ログ画面で入力した値がそのまま
 *     保持される。CSV取込が新規作成するvisit(createSequenced経由)はnextBookingMade=false
 *     固定のため、スタッフの事前入力が無い来店は常に「次回予約なし」判定になる
 *     (reservationsテーブル、予約CSV取込専用の非同期データソースとは連携しない。
 *     Phase 1-C調査で「データソースが非同期」と指摘された制約はそのまま残る既知の限界)。
 *     amountは金額概念が無いため0固定。
 *   - pack: 判定材料が不十分なため、Phase 1-Bcと同じ安全側固定値(false/false/0)の
 *     まま据え置く(今回未着手)。
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
  /**
   * Phase 1-Da: upsell判定用。CSV取込時点のagg.optionNames.length > 0を
   * 呼び出し元が渡す(brain_visitsにオプション購入有無を表す列が無いため、
   * Visit型からは導出できない)。homecare等の判定には使用しない。
   */
  hasOptionPurchase?: boolean;
  /**
   * Phase 1-Db: subscription判定用。CSV取込時点のagg.menuName/serviceNames/
   * retailNamesのいずれかに"サブスク"という文字列が含まれるかを呼び出し元が渡す
   * (brain_visitsにサブスク成約有無を表す列が無いため、Visit型からは導出できない)。
   * homecare/upsell等の判定には使用しない。
   */
  hasSubscriptionKeyword?: boolean;
}

export type RecordProposalOutcomeResult =
  | { recorded: true; outcomeId: string; ambiguousCandidateCount: number }
  | { recorded: false; reason: 'no_eligible_fire_log' | 'outside_match_window' | 'incomplete_fire_log_data' };

export async function recordProposalOutcome(
  input: RecordProposalOutcomeInput,
  repos: RecordProposalOutcomeRepos
): Promise<RecordProposalOutcomeResult> {
  const { visit, storeId, hasOptionPurchase, hasSubscriptionKeyword } = input;
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

  const proposalKind = dr.proposalKind as ProposalKind;
  const isHomecare = proposalKind === 'homecare';
  const isUpsell = proposalKind === 'upsell';
  const isSubscription = proposalKind === 'subscription';
  const isRebooking = proposalKind === 'rebooking';

  let wasExecuted = false;
  let wasAccepted = false;
  let amount = 0;

  if (isHomecare) {
    // Phase 1-Cb: この来店で実際に店販(ホームケア商品)が売上に計上されたか
    // (visit.retailAmount、CSV会計データのagg.retailSales由来)で判定する。無変更。
    wasExecuted = visit.retailAmount > 0;
    wasAccepted = visit.retailAmount > 0;
    amount = visit.retailAmount;
  } else if (isUpsell) {
    // Phase 1-Da: この来店でオプション行が1件でも購入されたか
    // (agg.optionNames.length > 0、呼び出し元からhasOptionPurchaseとして受け取る)で判定する。
    // amountはオプション単体の金額を個別集計する手段が無いため暫定的に0固定とする。無変更。
    wasExecuted = hasOptionPurchase === true;
    wasAccepted = hasOptionPurchase === true;
    amount = 0;
  } else if (isSubscription) {
    // Phase 1-Db: この来店の会計明細(menuName/serviceNames/retailNames)に
    // "サブスク"という文字列が含まれるか(呼び出し元からhasSubscriptionKeywordとして
    // 受け取る)で判定する。amountは金額を個別集計する手段が無いため暫定的に0固定とする。
    wasExecuted = hasSubscriptionKeyword === true;
    wasAccepted = hasSubscriptionKeyword === true;
    amount = 0;
  } else if (isRebooking) {
    // Phase 1-Dd: この来店で次回予約が入ったか(visit.nextBookingMade)で判定する。
    // amountは金額概念が無いため0固定とする。無変更。
    wasExecuted = visit.nextBookingMade;
    wasAccepted = visit.nextBookingMade;
    amount = 0;
  }
  // packは今回未着手のため false/false/0 のまま(初期値)。

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
