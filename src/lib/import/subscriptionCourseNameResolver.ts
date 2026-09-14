/**
 * subscriptionCourseNameResolver.ts — サブスク契約コース名の履歴ベース解決
 * (BASE_TREATMENT_NAME_RESOLUTION・2026-09-14)
 *
 * 背景: salonBoardDetailParser.ts の aggregateCheckouts() は単一CSVの行しか見えないため、
 * サブスク明細itemNameが直接コース名を含まない場合(「【サブスク決済日】※金額入力して
 * お会計」等、実データ12パターン中10パターンがこれに該当)は
 * baseTreatmentNameSource='subscription_unresolved' のまま返す。
 *
 * このモジュールは、同一顧客の他のサブスク明細(同一CSVバッチ内 + 既存
 * brain_subscription_payments履歴)を横断して、以下の優先順で「その来店日時点で
 * 有効だった契約コース名」を推定する(履歴ベース。現在の契約名をそのまま使わない):
 *   1. 対象itemName自体からの直接抽出(呼び出し側で既に試行済みのはずだが、念のため再試行)
 *   2. 同一顧客の他のサブスク明細から「金額→コース名」マップを作り、対象金額から逆引き
 *      (実データでは価格帯とコース名が1:1で対応することを確認済み。ただし将来的に価格が
 *      重複するコースが増える可能性はあるため、あくまで補助的な推定である点に留意)
 *   3. 履歴上「対象日以前で直近」の名前付き明細のコース名を採用(契約変更を跨いだ場合に
 *      過去の来店表示が書き換わらないようにするため、現在の契約ではなく履歴に基づく)。
 *      対象日以前に名前付き明細が無い場合のみ、「対象日以降で直近」にフォールバックする。
 *   4. いずれも解決できない場合は固定文言(UNRESOLVED_COURSE_NAME)を返す。
 */
import { extractSubscriptionCourseName, type SalonBoardCheckoutAggregate } from './salonBoardDetailParser'

export interface SubscriptionHistoryEntry {
  /** YYYY-MM-DD */
  date:     string
  itemName: string
  amount:   number
}

export type CourseNameResolutionMethod =
  | 'direct_extraction'
  | 'price_lookup'
  | 'nearest_history'
  | 'unresolved'

export interface ResolvedCourseName {
  courseName: string
  method:     CourseNameResolutionMethod
}

/** いずれの方法でも解決できなかった場合に表示する固定文言。UIで「詳細不明」である旨が伝わるようにする。 */
export const UNRESOLVED_COURSE_NAME = '契約コース（詳細不明）'

/**
 * @param targetDate   解決対象の来店日(YYYY-MM-DD)
 * @param targetAmount 解決対象のサブスク明細金額
 * @param targetItemName 解決対象のサブスク明細itemName(直接抽出を再試行するため)
 * @param customerHistory 同一顧客の他のサブスク明細履歴(このcheckout自身を含めてよい。
 *   日付順である必要は無い・内部でソートする)
 */
export function resolveSubscriptionCourseName(
  targetDate: string,
  targetAmount: number,
  targetItemName: string,
  customerHistory: SubscriptionHistoryEntry[]
): ResolvedCourseName {
  const direct = extractSubscriptionCourseName(targetItemName)
  if (direct) return { courseName: direct, method: 'direct_extraction' }

  const named = customerHistory
    .map(e => ({ ...e, courseName: extractSubscriptionCourseName(e.itemName) }))
    .filter((e): e is SubscriptionHistoryEntry & { courseName: string } => e.courseName !== null)

  if (named.length === 0) return { courseName: UNRESOLVED_COURSE_NAME, method: 'unresolved' }

  // 価格→コース名の逆引き(同一顧客内で価格帯が一致する名前付き明細を探す)。
  const priceMatch = named.find(e => e.amount === targetAmount)
  if (priceMatch) return { courseName: priceMatch.courseName, method: 'price_lookup' }

  // 履歴ベース: 対象日以前で直近の名前付き明細を優先し、無ければ対象日以降で直近にフォールバック。
  const before = named
    .filter(e => e.date <= targetDate)
    .sort((a, b) => b.date.localeCompare(a.date))
  if (before.length > 0) return { courseName: before[0].courseName, method: 'nearest_history' }

  const after = named
    .filter(e => e.date > targetDate)
    .sort((a, b) => a.date.localeCompare(b.date))
  if (after.length > 0) return { courseName: after[0].courseName, method: 'nearest_history' }

  return { courseName: UNRESOLVED_COURSE_NAME, method: 'unresolved' }
}

/**
 * 同一CSVバッチ内の会計から、顧客名(生文字列。customerIdでの照合はcsvImportPipeline.ts側の
 * 責務のためここでは行わない)ごとのサブスク明細履歴を組み立てる。1回のCSV取込に同一顧客の
 * 複数月分が含まれるケース(遡及是正の一括再取込等)で、DB履歴が無くても解決できるようにする。
 */
export function buildBatchHistoryByCustomer(
  aggregates: Pick<SalonBoardCheckoutAggregate, 'customerName' | 'visitDateTime' | 'subscriptionPayments'>[]
): Map<string, SubscriptionHistoryEntry[]> {
  const map = new Map<string, SubscriptionHistoryEntry[]>()
  for (const agg of aggregates) {
    if (agg.subscriptionPayments.length === 0) continue
    const date = agg.visitDateTime.slice(0, 10)
    const list = map.get(agg.customerName) ?? []
    for (const p of agg.subscriptionPayments) {
      list.push({ date, itemName: p.itemName, amount: p.amount })
    }
    map.set(agg.customerName, list)
  }
  return map
}
