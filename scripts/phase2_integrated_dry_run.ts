/**
 * phase2_integrated_dry_run.ts — 調査専用スクリプト(書き込みなし)
 *
 * サブスク決済分離Phase 2(治療費・来店回数の是正)と、BASE_TREATMENT_NAME_RESOLUTION
 * (基本施術メニュー名の履歴ベース解決)を、実装済みの本番ロジック(salonBoardDetailParser.ts/
 * subscriptionCourseNameResolver.ts)をそのまま使って統合的にDry Run分析する。
 * DBへの書き込みは一切行わない(本番DBは読み取り専用で参照する)。
 *
 * 使い方: npx ts-node --compiler-options "{\"module\":\"commonjs\"}" scripts/phase2_integrated_dry_run.ts
 */
import * as fs from 'fs'
import {
  parseSalonBoardDetailCsv, aggregateCheckouts, isOptionLine,
  type SalonBoardCheckoutAggregate,
} from '../src/lib/import/salonBoardDetailParser'
import { resolveSubscriptionCourseName, buildBatchHistoryByCustomer } from '../src/lib/import/subscriptionCourseNameResolver'

const CSV_PATH = 'archive/salonboard-csv-source/salonboard_export_20260501-20260912_utf8.csv'

function isPureSubscriptionCheckout(agg: SalonBoardCheckoutAggregate): boolean {
  return agg.subscriptionPayments.length > 0 && agg.treatmentLineCount === 0 && agg.retailSales === 0
}

function dateOnly(iso: string): string {
  return iso.slice(0, 10)
}

const csvText = fs.readFileSync(CSV_PATH, 'utf-8')
const parsed = parseSalonBoardDetailCsv(csvText)
const { aggregates } = aggregateCheckouts(parsed.rows)
const batchHistoryByCustomerName = buildBatchHistoryByCustomer(aggregates)

// ── ① Phase 2: サブスク金額分離の是正内容 ────────────────────────────────
let pureCount = 0
let mixedCount = 0
let untouchedCount = 0
const perCustomerAmountDelta = new Map<string, number>()

for (const agg of aggregates) {
  if (agg.subscriptionPayments.length === 0) { untouchedCount++; continue }
  const isPure = isPureSubscriptionCheckout(agg)
  if (isPure) {
    pureCount++
    // 是正後はvisit行自体が削除される想定。旧treatmentAmount(=サブスク金額そのもの)が
    // 丸ごとマイナスされる。
    const subTotal = agg.subscriptionPayments.reduce((s, p) => s + p.amount, 0)
    perCustomerAmountDelta.set(agg.customerName, (perCustomerAmountDelta.get(agg.customerName) ?? 0) - subTotal)
  } else {
    mixedCount++
    const subTotal = agg.subscriptionPayments.reduce((s, p) => s + p.amount, 0)
    perCustomerAmountDelta.set(agg.customerName, (perCustomerAmountDelta.get(agg.customerName) ?? 0) - subTotal)
  }
}

console.log('=== ① Phase 2: サブスク金額分離の是正内容 ===')
console.log(`対象342会計中 純粋サブスク会計=${pureCount}件 / 混在会計=${mixedCount}件 / 該当なし=${untouchedCount}件`)
console.log(`影響顧客数: ${perCustomerAmountDelta.size}名`)
const topAmount = Array.from(perCustomerAmountDelta.entries()).sort((a, b) => a[1] - b[1]).slice(0, 10)
console.log('treatment_amount影響額(上位10名):')
topAmount.forEach(([name, delta]) => console.log(`  ${name}: ${delta}円`))

// ── ② 基本メニュー名解決の是正内容(78件の汚染データがどう解決されるか) ──────
interface MenuNameChange {
  checkoutId: string
  customerName: string
  visitDate: string
  before: string           // このcheckoutが唯一の施術系行として残す旧menuName相当(参考表示)
  after: string
  afterSource: string
  isPure: boolean
}
const menuNameChanges: MenuNameChange[] = []

for (const agg of aggregates) {
  if (agg.baseTreatmentNameSource !== 'subscription_unresolved' && agg.baseTreatmentNameSource !== 'subscription_contract_named') continue
  // 「旧ロジックでは何が代表メニュー名になっていたか」を再現する(オプション除外前のロジック)。
  const oldTreatmentLines = [...agg.optionLines.map(o => ({ itemName: o.itemName, amount: o.amount }))]
  const oldRepresentative = oldTreatmentLines.length > 0
    ? oldTreatmentLines.reduce((best, l) => (l.amount > best.amount ? l : best)).itemName
    : (agg.subscriptionPayments.length > 0
      ? agg.subscriptionPayments.reduce((best, p) => (p.amount > best.amount ? p : best)).itemName
      : '')

  const resolvedName = agg.baseTreatmentNameSource === 'subscription_contract_named'
    ? agg.baseTreatmentName
    : resolveSubscriptionCourseName(
        dateOnly(agg.visitDateTime),
        agg.subscriptionPayments.reduce((best, p) => (p.amount > best.amount ? p : best)).amount,
        agg.subscriptionPayments.reduce((best, p) => (p.amount > best.amount ? p : best)).itemName,
        batchHistoryByCustomerName.get(agg.customerName) ?? []
      ).courseName

  const isPure = isPureSubscriptionCheckout(agg)
  if (oldRepresentative === resolvedName) continue // 変化なし(参考表示のみ・稀)

  menuNameChanges.push({
    checkoutId: agg.checkoutId,
    customerName: agg.customerName,
    visitDate: dateOnly(agg.visitDateTime),
    before: oldRepresentative,
    after: resolvedName,
    afterSource: agg.baseTreatmentNameSource,
    isPure,
  })
}

console.log('\n=== ② 基本メニュー名解決の是正内容 ===')
console.log(`是正対象(旧ロジックとメニュー名が変わる会計): ${menuNameChanges.length}件`)
const survivingChanges = menuNameChanges.filter(c => !c.isPure)
const discardedChanges = menuNameChanges.filter(c => c.isPure)
console.log(`  うちPhase2でvisit行ごと削除される(純粋サブスク会計・メニュー名は表示自体されなくなる): ${discardedChanges.length}件`)
console.log(`  うちvisitが存続しmenu_idの再解決が必要(混在会計): ${survivingChanges.length}件`)
console.log('\n--- 存続visitのmenu_id再解決 詳細一覧 ---')
survivingChanges.forEach(c => {
  console.log(`  ${c.customerName} ${c.visitDate} (checkout=${c.checkoutId}): "${c.before || '(空文字)'}" → "${c.after}" [${c.afterSource}]`)
})

// ── ③ hasOptionPurchase等、副次的に直る可能性のあるロジックへの影響 ─────────
let hasOptionLinesCount = 0
for (const agg of aggregates) {
  if (agg.optionLines.length > 0) hasOptionLinesCount++
}
console.log('\n=== ③ hasOptionPurchase副次影響 ===')
console.log(`旧ロジック(区分='オプション'条件・実データに存在せず常にfalse)によるhasOptionPurchase=true件数: 0件(常にfalseだった)`)
console.log(`新ロジック(品目名プレフィックス判定)でhasOptionPurchase=trueになる会計数: ${hasOptionLinesCount}件 / 342件`)
