/**
 * sumSubscriptionSales.ts — サブスク決済(brain_subscription_payments)の期間・
 * スタッフ別集計(2026-09-27ユーザー承認)。
 *
 * 背景: 経営TOP・スタッフ分析の「売上」はbrain_visits(来店ベース)のみを合算しており、
 * サブスク決済(brain_subscription_payments、SUBSCRIPTION_VISIT_SPLIT_PHASE1で意図的に
 * 分離済み)は含まれない。この差分がSalonBoardの合計金額と食い違って見える原因だった。
 *
 * 既存の客単価(monthlySales÷visitCount)・着地予測(来店ペースが前提)の計算式は
 * サブスクを含めると歪む(サブスクは来店を伴わない月額課金のため)ため、既存の
 * DashboardAggregator/StaffAnalyticsEngineの計算式には一切手を加えず、
 * 「サブスク売上」「総売上(来店+サブスク)」を別の参考値として追加するだけに留める。
 *
 * DashboardAggregator/StaffAnalyticsEngineと同じ「配列を取得しJS側の純粋関数で
 * 期間集計する」方針を踏襲する。DB/Supabaseには依存しない。
 */
export interface SubscriptionPaymentRecord {
  staffId: string | null
  amount: number
  paymentDate: string
}

/**
 * 期間内(start〜end、両端含む、YYYY-MM-DD文字列の辞書式比較)のサブスク決済合計。
 * staffIdを指定するとそのスタッフ担当分のみ合算する(staff_idがnullの決済は対象外)。
 */
export function sumSubscriptionSales(
  payments: SubscriptionPaymentRecord[],
  start: string,
  end: string,
  staffId?: string
): number {
  return payments
    .filter(p => p.paymentDate >= start && p.paymentDate <= end)
    .filter(p => staffId === undefined || p.staffId === staffId)
    .reduce((sum, p) => sum + p.amount, 0)
}
