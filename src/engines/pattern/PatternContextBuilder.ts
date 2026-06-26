/**
 * PatternContextBuilder.ts — ContextBundle(実データ) → PatternContext 変換
 *
 * 設計根拠: ProposalOrchestrator.ts冒頭コメント「範囲外: PatternContextBuilder
 * (ContextBundle -> PatternContext)」。本ファイルがその欠落を実装する。
 *
 * brain_customers/brain_visits/brain_subscriptions等から取得した実データのみを
 * 使用する(DB/Supabase非依存の純粋関数・モックデータ禁止)。実データソースが
 * 存在しない特徴量(CSI・肌記録ベースのskin_momentum等)は中立値またはnullを返し、
 * architecture文書にも厳密な数式定義が無い`subscConditionsMet`の算出方法は
 * 本ファイルで決定論的に定義する(下記コメント参照・暫定ハードコードではなく
 * 顧客の実履歴から決定論的に算出する4指標)。
 */
import type { ContextBundle, PatternContext } from '../../types/riora.types';

export type BuildPatternContextResult =
  | { ok: true; context: PatternContext }
  | { ok: false; reason: 'no_customer_type' | 'no_visit_history' };

/**
 * subscConditionsMet(0-4)の算出方法(本ファイルで新規定義・決定論ルール):
 * brain_pattern_steps.fire_condition(サブスク提案)はvisit_count/homecare_declined_recent/
 * churn_scoreを別途直接参照するため、本指標はそれらと重複しない4つの実データ指標で
 * 「関係性の成熟度」を表す:
 *   ① 来店回数が3回以上(関係性が確立している)
 *   ② ホームケア購入歴がある(エンゲージメントがある)
 *   ③ 直近2回指名が連続している(担当との関係性がある)
 *   ④ 店販購入歴がある(治療以外への投資実績がある)
 */
function computeSubscConditionsMet(opts: {
  visitCount: number;
  homecarePurchasedEver: boolean;
  isNominationStreak2: boolean;
  retailTotal: number;
}): 0 | 1 | 2 | 3 | 4 {
  let met = 0;
  if (opts.visitCount >= 3) met += 1;
  if (opts.homecarePurchasedEver) met += 1;
  if (opts.isNominationStreak2) met += 1;
  if (opts.retailTotal > 0) met += 1;
  return met as 0 | 1 | 2 | 3 | 4;
}

/** DB/Supabaseに依存しない純粋関数。実データのみを使用する(モックデータ・固定値で埋めない)。 */
export function buildPatternContext(bundle: ContextBundle, nowJst: string): BuildPatternContextResult {
  const { customer, visits, skinRecords } = bundle;

  if (!customer.customerType) {
    return { ok: false, reason: 'no_customer_type' };
  }
  if (visits.length === 0) {
    return { ok: false, reason: 'no_visit_history' };
  }

  const sortedVisits = visits.slice().sort((a, b) => a.visitDate.localeCompare(b.visitDate));
  const last = sortedVisits[sortedVisits.length - 1];
  const visitCount = sortedVisits.length;

  const gaps: number[] = [];
  for (let i = 1; i < sortedVisits.length; i++) {
    gaps.push((Date.parse(sortedVisits[i].visitDate) - Date.parse(sortedVisits[i - 1].visitDate)) / 86_400_000);
  }
  // 来店履歴が1件のみの場合、平均来店周期は算出不能。brain_success_patterns.target_cycle_days
  // (実データ・パターンマスタの設計値)を中立フォールバックとして使う方が、架空の周期を
  // 作るより誠実(呼び出し側がpatternのtarget_cycle_daysを渡せない場合は30日を既定とする)。
  const avgCycle = gaps.length > 0 ? gaps.reduce((sum, g) => sum + g, 0) / gaps.length : 30;

  const daysSinceLast = (Date.parse(nowJst.slice(0, 10)) - Date.parse(last.visitDate)) / 86_400_000;

  const isNominationStreak2 = sortedVisits.length >= 2
    && sortedVisits[sortedVisits.length - 1].isNomination
    && sortedVisits[sortedVisits.length - 2].isNomination;

  const homecarePurchasedEver = sortedVisits.some((v) => v.homecarePurchased);
  const homecareDeclinedRecent = last.homecareDeclined;
  const retailTotal = sortedVisits.reduce((sum, v) => sum + v.retailAmount, 0);

  // skin_momentum: 直近2回のprimary_deltaの勾配。brain_skin_records相当の実データが
  // 渡されていない場合は中立値0(改善も悪化もしていないとみなす・架空の改善を作らない)。
  const sortedSkin = skinRecords.slice().sort((a, b) => a.id.localeCompare(b.id));
  const lastTwoDeltas = sortedSkin.slice(-2).map((r) => r.primaryDelta).filter((d): d is number => d !== null);
  const skinDeltaTrend = lastTwoDeltas.length > 0
    ? lastTwoDeltas.reduce((sum, d) => sum + d, 0) / lastTwoDeltas.length
    : 0;
  const skinImproved = skinDeltaTrend > 0;
  const skinStagnant2 = lastTwoDeltas.length === 2 && lastTwoDeltas.every((d) => d === 0);

  const weddingDaysLeft = customer.weddingDate
    ? Math.round((Date.parse(customer.weddingDate) - Date.parse(nowJst.slice(0, 10))) / 86_400_000)
    : null;

  const subscConditionsMet = computeSubscConditionsMet({ visitCount, homecarePurchasedEver, isNominationStreak2, retailTotal });

  const cycleRatio = avgCycle > 0 ? daysSinceLast / avgCycle : 0;

  return {
    ok: true,
    context: {
      visitCount,
      daysSinceLast: Math.round(daysSinceLast),
      avgCycle: Math.round(avgCycle),
      isNominationStreak2,
      homecarePurchasedEver,
      homecareDeclinedRecent,
      skinImproved,
      skinStagnant2,
      subscConditionsMet,
      // churn_scoreは現状どの工程からも更新されない既知の制約があるが(AIWarningEngine調査済み)、
      // 本ファイルは新たな計算式を導入せずbrain_customers.churn_scoreの実値をそのまま使う
      // (0が実際の格納値であれば0を正直に使う・架空のリスク値を作らない)。
      churnScore: customer.churnScore,
      nextBookingMadeLast: last.nextBookingMade,
      weddingDaysLeft,
      retailTotal,
      raw: {
        typeConfidence: customer.typeConfidence,
        // CSI(関係資産インデックス)の実データソースが現状無いため中立値0.5固定
        // (架空の高評価/低評価を作らないため・将来CSI実装時にここを置き換える)。
        csi: 0.5,
        skinDeltaTrend,
        cycleRatio,
        lastVisitDate: last.visitDate,
      },
      customerType: customer.customerType,
      customerId: customer.id,
      storeId: customer.storeId,
    },
  };
}
