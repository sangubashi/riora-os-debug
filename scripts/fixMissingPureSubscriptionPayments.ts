/**
 * fixMissingPureSubscriptionPayments.ts — subscriptionPhase2Execution.tsのバグ修正
 *
 * 本実行(2026-09-14)で判明した不具合: brain_subscription_payments書込みループが
 * visitのsoft delete後に実行されるため、純粋サブスク会計(74件)の顧客照合が
 * findByCustomerAndDate()の「deleted_at IS NULL」条件に阻まれて全件スキップされ、
 * brain_subscription_paymentsに記録されなかった。
 *
 * このスクリプトは、本実行前に取得したバックアップ(backups/…/brain_visits.json、
 * visitのsoft delete前の全カラムを含む)からvisit_id→customer_idを引き、
 * 純粋サブスク会計分のbrain_subscription_payments書込みのみを追加で行う
 * (混在会計58件分は既に正しく書き込み済みのため対象外)。
 *
 * デフォルトはdry-run。実際に書き込むには --execute を渡す。
 */
import * as fs from 'fs'
import { createClient } from '@supabase/supabase-js'
import { DEMO_STORE_ID } from '../src/lib/constants'
import { StaffRepo } from '../src/repositories/supabase/StaffRepo'
import { SubscriptionPaymentRepo } from '../src/repositories/supabase/SubscriptionPaymentRepo'
import { parseSalonBoardDetailCsv, aggregateCheckouts, type SalonBoardCheckoutAggregate } from '../src/lib/import/salonBoardDetailParser'
import { buildStaffLookup, resolveStaffId } from '../src/lib/import/staffResolver'

const EXECUTE = process.argv.includes('--execute')
const CSV_PATH = 'archive/salonboard-csv-source/salonboard_export_20260501-20260912_utf8.csv'
const BACKUP_VISITS_PATH = 'backups/20260914_subscription_phase2_pre_execution/brain_visits.json'

function dateOnly(iso: string): string { return iso.slice(0, 10) }
function isPureSubscriptionCheckout(agg: SalonBoardCheckoutAggregate): boolean {
  return agg.subscriptionPayments.length > 0 && agg.treatmentLineCount === 0 && agg.retailSales === 0
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY is required')
  const raw = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const staffRepo = new StaffRepo(raw)
  const subscriptionPaymentRepo = new SubscriptionPaymentRepo(raw)

  const backup = JSON.parse(fs.readFileSync(BACKUP_VISITS_PATH, 'utf-8')) as {
    softDeleteTargetIds: string[]
    rows: { id: string; customer_id: string; visit_date: string }[]
  }
  const customerIdByVisitId = new Map(backup.rows.map(r => [r.id, r.customer_id]))
  const softDeleteVisitIdSet = new Set(backup.softDeleteTargetIds)

  const csvText = fs.readFileSync(CSV_PATH, 'utf-8')
  const parsed = parseSalonBoardDetailCsv(csvText)
  const { aggregates: allAggregates } = aggregateCheckouts(parsed.rows)
  const pureAggregates = allAggregates.filter(a => a.subscriptionPayments.length > 0 && isPureSubscriptionCheckout(a))

  const staff = await staffRepo.listByStore(DEMO_STORE_ID)
  const staffLookup = buildStaffLookup(staff.map(s => ({ id: s.id, name: s.name, nameAliases: s.nameAliases })))

  // バックアップのbrain_visits.jsonはsoft delete対象74件(visit単位)を記録している。
  // CSV側は同日複数会計の集約で78件(会計単位)あるため、customer名+来店日で対応させる。
  // バックアップのrowsから customerId は分かるが、氏名は含まれないため、
  // 同じ日付・同じ顧客への複数会計はバックアップの「どのvisitId」に属するかを
  // 一意に決める必要がある → 会計単位ではなくvisit単位(customerId+visitDate)で
  // 集約し直し、該当visitIdのcustomer_idをそのまま使う。
  //
  // 顧客名からcustomer_idへの逆引きが無いため、CSV側のcustomerNameで直接
  // 名寄せはせず、Supabase側の brain_customers を引いて名前を確認する。
  const { data: customers } = await raw.from('brain_customers').select('id, name').eq('store_id', DEMO_STORE_ID)
  const nameById = new Map((customers ?? []).map((c: { id: string; name: string }) => [c.id, c.name]))

  interface MissingPayment {
    checkoutId: string
    customerName: string
    customerId: string
    visitDate: string
    itemName: string
    amount: number
    staffId: string | null
  }
  const missing: MissingPayment[] = []
  const unresolvedCustomer: { checkoutId: string; customerName: string; visitDate: string }[] = []

  // visitId→customerIdのマップを氏名+日付で引けるように変換する。
  // brain_customers.nameは「碓井志歩」のようにスペース無し表記の既存データが2件存在し、
  // CSV側(agg.customerName)は常に「碓井 志歩」のようにスペース有りで正規化されるため、
  // 空白を除去して比較する(表記ゆれ吸収)。
  const normalizeName = (s: string) => s.replace(/\s+/g, '')
  const visitByNameDate = new Map<string, string>() // key: `${normalizedName}__${date}` → customerId
  for (const row of backup.rows) {
    if (!softDeleteVisitIdSet.has(row.id)) continue
    const name = nameById.get(row.customer_id)
    if (!name) continue
    visitByNameDate.set(`${normalizeName(name)}__${row.visit_date}`, row.customer_id)
  }

  for (const agg of pureAggregates) {
    const visitDate = dateOnly(agg.visitDateTime)
    const customerId = visitByNameDate.get(`${normalizeName(agg.customerName)}__${visitDate}`)
    if (!customerId) {
      unresolvedCustomer.push({ checkoutId: agg.checkoutId, customerName: agg.customerName, visitDate })
      continue
    }
    const staffRes = resolveStaffId(agg.staffNameRaw, staffLookup)
    for (const p of agg.subscriptionPayments) {
      missing.push({
        checkoutId: agg.checkoutId, customerName: agg.customerName, customerId, visitDate,
        itemName: p.itemName, amount: p.amount,
        staffId: staffRes.status === 'unresolved' ? null : staffRes.staffId,
      })
    }
  }

  console.log(`=== モード: ${EXECUTE ? '本実行(書き込みあり)' : 'Dry Run(書き込みなし)'} ===`)
  console.log(`修正対象(純粋サブスク会計・書込み予定): ${missing.length}件`)
  missing.forEach(m => console.log(`  ${m.customerName} ${m.visitDate} (checkout=${m.checkoutId}): "${m.itemName}" ¥${m.amount} staffId=${m.staffId ?? '(未解決)'}`))
  if (unresolvedCustomer.length > 0) {
    console.log(`\n顧客照合できず(要個別確認): ${unresolvedCustomer.length}件`)
    unresolvedCustomer.forEach(u => console.log(`  ${u.customerName} ${u.visitDate} (checkout=${u.checkoutId})`))
  }

  if (!EXECUTE) {
    console.log('\n=== Dry Runのみ。--execute を付けて実行するまでDBへの書き込みは一切行われません。 ===')
    return
  }

  // checkout_id単位でreplaceForCheckout()を呼ぶ(このcheckout_idは初回書込みのため冪等性は問題ない)
  const byCheckout = new Map<string, MissingPayment[]>()
  for (const m of missing) {
    const list = byCheckout.get(m.checkoutId) ?? []
    list.push(m)
    byCheckout.set(m.checkoutId, list)
  }
  for (const [checkoutId, items] of Array.from(byCheckout.entries())) {
    const staffId = items[0].staffId
    if (!staffId) { console.warn(`  ⚠ staffId未解決のためスキップ: checkout=${checkoutId}`); continue }
    await subscriptionPaymentRepo.replaceForCheckout(checkoutId, items.map((i: MissingPayment) => ({
      storeId: DEMO_STORE_ID, customerId: i.customerId, visitId: null, staffId,
      itemName: i.itemName, amount: i.amount, paymentDate: i.visitDate,
    })))
  }
  console.log(`\n✓ ${byCheckout.size}会計分(${missing.length}明細)のbrain_subscription_paymentsを追加記録`)
}

main().catch(e => { console.error(e); process.exit(1) })
