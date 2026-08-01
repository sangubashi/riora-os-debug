/**
 * detectOverdueCustomers.ts — 「今日のブリーフィング」担当顧客ロスター向けルール
 * (PHASE STAFF-NOTIFICATION-AI-2・純粋関数・DB非依存・LLM不使用)
 *
 * 対象は「本日すでに予約が入っている顧客」ではなく、担当顧客のうち今日まだ
 * 予約が入っていない人。3種のいずれも固定しきい値のみで判定するルールベースで、
 * スコアリング・AI生成は行わない。
 *
 *   ①再来推奨日超過  brain_customers.recommended_cycle_days(スタッフ/メニュー側で
 *                    設定済みの推奨来店サイクル)を、最終来店からの経過日数が
 *                    超えている場合のみ判定する。
 *   ②来店45日以上    最終来店(brain_visits.visit_date)から45日以上経過。
 *
 *   ①と②は排他(PHASE STAFF-NOTIFICATION-AI-3・ユーザー指摘2026-08-01):
 *   recommended_cycle_daysが設定されている顧客は①のみを判定し、②は判定しない
 *   (例: 推奨サイクル35日・前回来店50日の場合、「再来推奨日を過ぎています」と
 *   「前回来店から50日経過しています」の2件が同時に出ると、スタッフには同じ
 *   ことを2回言われているように見えるため)。recommended_cycle_daysが未設定
 *   (null・0以下)の顧客のみ②を判定する(推奨日という個別基準が無い顧客の
 *   「見落とし」を防ぐための一般的なしきい値)。
 *
 *   ③店販60日以上    店販商品の最終購入(brain_visits.retail_category)から
 *                    60日以上経過。一度も店販購入が無い顧客は対象外。
 */

const STALE_VISIT_THRESHOLD_DAYS = 45
const RETAIL_REPLENISH_THRESHOLD_DAYS = 60

export interface RosterCustomerInput {
  id: string
  /** brain_visits.visit_date の最新値。来店記録が無い場合はnull。 */
  lastVisitDate: string | null
  /** retail_category が入っている brain_visits.visit_date の最新値。店販購入記録が無い場合はnull。 */
  lastRetailPurchaseDate: string | null
  /** brain_customers.recommended_cycle_days。未設定はnull。 */
  recommendedCycleDays: number | null
}

export interface DailyOverdueCounts {
  recommendedRevisitCount: number
  staleVisitCount: number
  retailReplenishCount: number
  /** 該当した顧客のid一覧(PHASE STAFF-NOTIFICATION-TAP-1・通知タップ→顧客詳細遷移用)。 */
  recommendedRevisitIds: string[]
  staleVisitIds: string[]
  retailReplenishIds: string[]
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function daysSince(dateStr: string, today: Date): number {
  const past = startOfDay(new Date(dateStr))
  const base = startOfDay(today)
  return Math.round((base.getTime() - past.getTime()) / 86_400_000)
}

/** 単一顧客について、3項目それぞれに該当するかを返す。 */
export function evaluateOverdueCustomer(
  customer: RosterCustomerInput,
  today: Date = new Date()
): { recommendedRevisit: boolean; staleVisit: boolean; retailReplenish: boolean } {
  let recommendedRevisit = false
  let staleVisit = false
  let retailReplenish = false

  if (customer.lastVisitDate) {
    const days = daysSince(customer.lastVisitDate, today)
    if (days >= 0) {
      const hasRecommendedCycle = customer.recommendedCycleDays !== null && customer.recommendedCycleDays > 0
      if (hasRecommendedCycle) {
        // 個別の推奨サイクルがある顧客は①のみを判定する(②との重複通知を避ける)。
        recommendedRevisit = days > customer.recommendedCycleDays!
      } else {
        // 推奨サイクルが無い顧客のみ、固定45日しきい値で判定する。
        staleVisit = days >= STALE_VISIT_THRESHOLD_DAYS
      }
    }
  }

  if (customer.lastRetailPurchaseDate) {
    const days = daysSince(customer.lastRetailPurchaseDate, today)
    if (days >= 0) {
      retailReplenish = days >= RETAIL_REPLENISH_THRESHOLD_DAYS
    }
  }

  return { recommendedRevisit, staleVisit, retailReplenish }
}

/** 担当顧客ロスター全体を集計する(重複カウントなし・1顧客1カウントまで)。 */
export function countOverdueCustomers(
  customers: RosterCustomerInput[],
  today: Date = new Date()
): DailyOverdueCounts {
  const recommendedRevisitIds: string[] = []
  const staleVisitIds: string[] = []
  const retailReplenishIds: string[] = []

  for (const c of customers) {
    const result = evaluateOverdueCustomer(c, today)
    if (result.recommendedRevisit) recommendedRevisitIds.push(c.id)
    if (result.staleVisit) staleVisitIds.push(c.id)
    if (result.retailReplenish) retailReplenishIds.push(c.id)
  }

  return {
    recommendedRevisitCount: recommendedRevisitIds.length,
    staleVisitCount: staleVisitIds.length,
    retailReplenishCount: retailReplenishIds.length,
    recommendedRevisitIds,
    staleVisitIds,
    retailReplenishIds,
  }
}
