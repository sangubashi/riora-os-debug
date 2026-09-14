/**
 * subscriberFlagBackfill.ts — is_subscriber/subscribed_at 遡及バッチ
 *
 * サブスク決済分離Phase 2実行後、既存顧客のis_subscriber(過去に一度でもサブスク契約を
 * したことがあるかを表す恒久的な履歴フラグ)・subscribed_at(その最初の契約日)を、
 * アーカイブCSVから遡及的に設定する。
 *
 * 判定規則(2026-09-14確定): 名前付き契約明細(【サブスク契約】/【サブスク会員様】、
 * extractSubscriptionCourseName()で抽出可能なもの)を検出できた顧客のみを対象にする。
 * 名前を含まない決済(【サブスク決済日】等)しか記録が無い顧客は対象外(このスクリプトの
 * 判定基準では検出できない。Dry Run結果の「② 検出できない対象」を参照)。
 *
 * 対象日は、その顧客の名前付き契約明細のうち最も古い日付(複数のプラン変更履歴がある
 * 場合でも「最初の契約日」を採用する)。
 *
 * デフォルトはdry-run。実際に書き込むには --execute を渡す。
 *
 * 使い方:
 *   Dry Run: npx ts-node --compiler-options "{\"module\":\"commonjs\"}" scripts/subscriberFlagBackfill.ts
 *   本実行:  npx ts-node --compiler-options "{\"module\":\"commonjs\"}" scripts/subscriberFlagBackfill.ts --execute
 */
import * as fs from 'fs'
import { createClient } from '@supabase/supabase-js'
import { DEMO_STORE_ID } from '../src/lib/constants'
import { CustomerRepo } from '../src/repositories/supabase/CustomerRepo'
import {
  parseSalonBoardDetailCsv, aggregateCheckouts, extractSubscriptionCourseName,
} from '../src/lib/import/salonBoardDetailParser'
import { findNameCandidates } from '../src/lib/import/customerMatcher'

const EXECUTE = process.argv.includes('--execute')
const CSV_PATH = 'archive/salonboard-csv-source/salonboard_export_20260501-20260912_utf8.csv'

function dateOnly(iso: string): string { return iso.slice(0, 10) }

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY is required')
  const raw = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const customerRepo = new CustomerRepo(raw)

  const csvText = fs.readFileSync(CSV_PATH, 'utf-8')
  const parsed = parseSalonBoardDetailCsv(csvText)
  const { aggregates } = aggregateCheckouts(parsed.rows)

  // 顧客名ごとに「名前付き契約明細の最古の日付」を集計する
  const earliestNamedDateByCustomerName = new Map<string, string>()
  // 参考: 名前を含まない決済しか無かった顧客(検出できない対象)も別途記録する
  const unnamedOnlyCustomerNames = new Set<string>()

  for (const agg of aggregates) {
    if (agg.subscriptionPayments.length === 0) continue
    const visitDate = dateOnly(agg.visitDateTime)
    const hasNamed = agg.subscriptionPayments.some(p => extractSubscriptionCourseName(p.itemName) !== null)
    if (hasNamed) {
      const existing = earliestNamedDateByCustomerName.get(agg.customerName)
      if (!existing || visitDate < existing) earliestNamedDateByCustomerName.set(agg.customerName, visitDate)
    } else if (!earliestNamedDateByCustomerName.has(agg.customerName)) {
      unnamedOnlyCustomerNames.add(agg.customerName)
    }
  }
  // 名前付きが後から見つかった顧客はunnamedOnlyから除外する
  for (const name of Array.from(earliestNamedDateByCustomerName.keys())) unnamedOnlyCustomerNames.delete(name)

  const existingCustomers = await customerRepo.listByStore(DEMO_STORE_ID)

  interface Plan { customerName: string; customerId: string; earliestDate: string; currentIsSubscriber: boolean; currentSubscribedAt: string | null }
  const plans: Plan[] = []
  const unmatchedNames: string[] = []

  for (const [name, earliestDate] of Array.from(earliestNamedDateByCustomerName.entries())) {
    const candidates = findNameCandidates(name, existingCustomers)
    if (candidates.length !== 1) {
      unmatchedNames.push(name)
      continue
    }
    const customer = existingCustomers.find(c => c.id === candidates[0].customerId)
    if (!customer) { unmatchedNames.push(name); continue }
    plans.push({
      customerName: name, customerId: customer.id, earliestDate,
      currentIsSubscriber: customer.isSubscriber, currentSubscribedAt: customer.subscribedAt,
    })
  }

  console.log(`=== モード: ${EXECUTE ? '本実行(書き込みあり)' : 'Dry Run(書き込みなし)'} ===`)
  console.log(`\n① 名前付き契約明細を検出した顧客: ${plans.length}名`)
  const toUpdate = plans.filter(p => !p.currentIsSubscriber)
  const alreadySet = plans.filter(p => p.currentIsSubscriber)
  console.log(`  うち更新対象(is_subscriber=falseのまま): ${toUpdate.length}名`)
  console.log(`  うち既にis_subscriber=true(スキップ・冪等): ${alreadySet.length}名`)
  toUpdate.forEach(p => console.log(`    ${p.customerName}: is_subscriber false→true, subscribed_at → ${p.earliestDate}`))
  if (alreadySet.length > 0) {
    console.log('  --- 既にtrueの顧客(参考) ---')
    alreadySet.forEach(p => console.log(`    ${p.customerName}: 現在のsubscribed_at=${p.currentSubscribedAt}(推定契約日${p.earliestDate}と${p.currentSubscribedAt === p.earliestDate ? '一致' : '不一致・要確認'})`))
  }

  console.log(`\n② 名前付き契約明細が検出できない顧客(このバッチの対象外・要個別判断): ${unnamedOnlyCustomerNames.size}名`)
  Array.from(unnamedOnlyCustomerNames).forEach(name => console.log(`    ${name}`))

  if (unmatchedNames.length > 0) {
    console.log(`\n顧客照合できず(要個別確認): ${unmatchedNames.length}名`)
    unmatchedNames.forEach(n => console.log(`    ${n}`))
  }

  if (!EXECUTE) {
    console.log('\n=== Dry Runのみ。--execute を付けて実行するまでDBへの書き込みは一切行われません。 ===')
    return
  }

  for (const p of toUpdate) {
    await customerRepo.markAsSubscriber!(p.customerId, p.earliestDate)
  }
  console.log(`\n✓ ${toUpdate.length}名のis_subscriber/subscribed_atを設定`)
}

main().catch(e => { console.error(e); process.exit(1) })
