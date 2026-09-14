/**
 * exportPrePhase2Backup.ts — サブスク決済分離Phase2+基本メニュー名解決 本実行前バックアップ
 *
 * SupabaseがFreeプランで業務データの全体バックアップ機構が無いため、本実行
 * (subscriptionPhase2Execution.ts --execute)で影響を受ける行を実行前にJSONで
 * ./backups/配下へ書き出す。読み取りのみ・DBへの書き込みは一切行わない。
 *
 * 出力先: ./backups/<YYYYMMDD>_subscription_phase2_pre_execution/
 *   - brain_visits.json               (soft delete対象74件 + 是正対象58件、現状の全カラム)
 *   - brain_subscription_payments.json (今回新規作成される予定の明細。まだ存在しないため
 *                                        「書込み予定payload」として記録する)
 *   - brain_menus.json                 (今回新規作成される予定の5メニュー。同上)
 *   - brain_proposal_outcomes.json     (soft delete対象visitを参照する既存20件、現状の全カラム)
 *   - brain_visit_retail_items.json    (soft delete対象visitを参照する既存2件、現状の全カラム)
 *
 * 使い方: npx ts-node --compiler-options "{\"module\":\"commonjs\"}" scripts/exportPrePhase2Backup.ts
 */
import * as fs from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'
import { DEMO_STORE_ID } from '../src/lib/constants'
import { CustomerRepo } from '../src/repositories/supabase/CustomerRepo'
import { VisitRepo } from '../src/repositories/supabase/VisitRepo'
import { StaffRepo } from '../src/repositories/supabase/StaffRepo'
import { MenuRepo } from '../src/repositories/supabase/MenuRepo'
import { SubscriptionPaymentRepo } from '../src/repositories/supabase/SubscriptionPaymentRepo'
import {
  parseSalonBoardDetailCsv, aggregateCheckouts, type SalonBoardCheckoutAggregate,
} from '../src/lib/import/salonBoardDetailParser'
import { resolveSubscriptionCourseName, buildBatchHistoryByCustomer } from '../src/lib/import/subscriptionCourseNameResolver'
import { buildMenuLookup, previewFallbackMenu } from '../src/lib/import/menuResolver'
import { buildStaffLookup, resolveStaffId } from '../src/lib/import/staffResolver'
import { findNameCandidates } from '../src/lib/import/customerMatcher'
import type { Customer } from '../src/types/riora.types'

const CSV_PATH = 'archive/salonboard-csv-source/salonboard_export_20260501-20260912_utf8.csv'

function dateOnly(iso: string): string { return iso.slice(0, 10) }
function isPureSubscriptionCheckout(agg: SalonBoardCheckoutAggregate): boolean {
  return agg.subscriptionPayments.length > 0 && agg.treatmentLineCount === 0 && agg.retailSales === 0
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY is required')
  const raw = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const repos = {
    customerRepo: new CustomerRepo(raw),
    visitRepo: new VisitRepo(raw),
    staffRepo: new StaffRepo(raw),
    menuRepo: new MenuRepo(raw),
    subscriptionPaymentRepo: new SubscriptionPaymentRepo(raw),
  }

  const csvText = fs.readFileSync(CSV_PATH, 'utf-8')
  const parsed = parseSalonBoardDetailCsv(csvText)
  const { aggregates: allAggregates } = aggregateCheckouts(parsed.rows)
  const targetAggregates = allAggregates.filter(a => a.subscriptionPayments.length > 0)
  const batchHistoryByCustomerName = buildBatchHistoryByCustomer(targetAggregates)

  const [existingCustomers, staff, menus] = await Promise.all([
    repos.customerRepo.listByStore(DEMO_STORE_ID),
    repos.staffRepo.listByStore(DEMO_STORE_ID),
    repos.menuRepo.listByStore(DEMO_STORE_ID),
  ])
  const staffLookup = buildStaffLookup(staff.map(s => ({ id: s.id, name: s.name, nameAliases: s.nameAliases })))
  const menuLookup = buildMenuLookup(menus)

  const deletionVisitIds = new Set<string>()
  const correctionVisitIds = new Set<string>()
  const plannedSubscriptionPayments: Record<string, unknown>[] = []
  const plannedNewMenuNames = new Set<string>()

  for (const agg of targetAggregates) {
    const visitDate = dateOnly(agg.visitDateTime)
    const nameCandidates = findNameCandidates(agg.customerName, existingCustomers)
    let matchedCustomer: Customer | null = null
    let existingVisit: Awaited<ReturnType<typeof repos.visitRepo.findByCustomerAndDate>> = null
    for (const c of nameCandidates) {
      const v = await repos.visitRepo.findByCustomerAndDate(c.customerId, visitDate)
      if (v) { matchedCustomer = existingCustomers.find(ec => ec.id === c.customerId) ?? null; existingVisit = v; break }
    }
    if (!matchedCustomer || !existingVisit || existingVisit.source !== 'salonboard_import') continue

    const isPure = isPureSubscriptionCheckout(agg)
    const staffRes = resolveStaffId(agg.staffNameRaw, staffLookup)

    if (isPure) {
      deletionVisitIds.add(existingVisit.id)
    } else {
      correctionVisitIds.add(existingVisit.id)

      let resolvedBaseTreatmentName = agg.baseTreatmentName
      if (agg.baseTreatmentNameSource === 'subscription_unresolved' && agg.subscriptionPayments.length > 0) {
        const repSub = agg.subscriptionPayments.reduce((best, p) => (p.amount > best.amount ? p : best))
        const dbHistory = await repos.subscriptionPaymentRepo.listByCustomer(matchedCustomer.id)
        const merged = [
          ...dbHistory.map(h => ({ date: h.paymentDate, itemName: h.itemName, amount: h.amount })),
          ...(batchHistoryByCustomerName.get(agg.customerName) ?? []),
        ]
        resolvedBaseTreatmentName = resolveSubscriptionCourseName(visitDate, repSub.amount, repSub.itemName, merged).courseName
      }
      const menuNameChanged = resolvedBaseTreatmentName !== '' && agg.baseTreatmentNameSource !== 'treatment_line'
      if (menuNameChanged) {
        const preview = previewFallbackMenu(resolvedBaseTreatmentName, menuLookup)
        if (preview.wouldCreate) plannedNewMenuNames.add(resolvedBaseTreatmentName)
      }
    }

    if (staffRes.status !== 'unresolved') {
      const visitIdForPayment = isPure ? null : existingVisit.id
      for (const p of agg.subscriptionPayments) {
        plannedSubscriptionPayments.push({
          storeId: DEMO_STORE_ID, customerId: matchedCustomer.id, customerName: matchedCustomer.name,
          visitId: visitIdForPayment, checkoutId: agg.checkoutId, staffId: staffRes.staffId,
          itemName: p.itemName, amount: p.amount, paymentDate: visitDate,
        })
      }
    }
  }

  const dateTag = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const outDir = path.resolve(`backups/${dateTag}_subscription_phase2_pre_execution`)
  fs.mkdirSync(outDir, { recursive: true })

  function writeJson(fileName: string, data: unknown) {
    fs.writeFileSync(path.join(outDir, fileName), JSON.stringify(data, null, 2), 'utf-8')
  }

  // ── brain_visits(soft delete対象 + 是正対象、現状の全カラム) ────────────────
  const allTargetVisitIds = [...Array.from(deletionVisitIds), ...Array.from(correctionVisitIds)]
  const { data: visitRows, error: visitErr } = await raw
    .from('brain_visits').select('*').in('id', allTargetVisitIds)
  if (visitErr) throw new Error(`brain_visits export failed: ${visitErr.message}`)
  writeJson('brain_visits.json', {
    exportedAt: new Date().toISOString(),
    softDeleteTargetCount: deletionVisitIds.size,
    correctionTargetCount: correctionVisitIds.size,
    softDeleteTargetIds: Array.from(deletionVisitIds),
    correctionTargetIds: Array.from(correctionVisitIds),
    rows: visitRows,
  })

  // ── brain_proposal_outcomes(soft delete対象visitを参照する既存分) ──────────
  const { data: outcomeRows, error: outcomeErr } = await raw
    .from('brain_proposal_outcomes').select('*').in('visit_id', Array.from(deletionVisitIds))
  if (outcomeErr) throw new Error(`brain_proposal_outcomes export failed: ${outcomeErr.message}`)
  writeJson('brain_proposal_outcomes.json', { exportedAt: new Date().toISOString(), rows: outcomeRows })

  // ── brain_visit_retail_items(soft delete対象visitを参照する既存分) ─────────
  const { data: retailRows, error: retailErr } = await raw
    .from('brain_visit_retail_items').select('*').in('visit_id', Array.from(deletionVisitIds))
  if (retailErr) throw new Error(`brain_visit_retail_items export failed: ${retailErr.message}`)
  writeJson('brain_visit_retail_items.json', { exportedAt: new Date().toISOString(), rows: retailRows })

  // ── brain_subscription_payments(まだ存在しない。書込み予定payloadを記録) ───
  writeJson('brain_subscription_payments.json', {
    exportedAt: new Date().toISOString(),
    note: 'このテーブルの当該行は本実行前時点ではまだ存在しないため、書込み予定のpayloadを記録する(既存行のバックアップではない)。',
    plannedInsertCount: plannedSubscriptionPayments.length,
    rows: plannedSubscriptionPayments,
  })

  // ── brain_menus(まだ存在しない。作成予定の5件を記録) ────────────────────────
  writeJson('brain_menus.json', {
    exportedAt: new Date().toISOString(),
    note: 'このテーブルの当該行は本実行前時点ではまだ存在しないため、作成予定のメニュー名を記録する(既存行のバックアップではない)。',
    plannedCreateCount: plannedNewMenuNames.size,
    plannedMenuNames: Array.from(plannedNewMenuNames),
  })

  console.log(`出力先: ${outDir}`)
  console.log(`brain_visits.json: ${visitRows?.length ?? 0}件 (想定: soft delete ${deletionVisitIds.size}件 + 是正 ${correctionVisitIds.size}件 = ${allTargetVisitIds.length}件)`)
  console.log(`brain_proposal_outcomes.json: ${outcomeRows?.length ?? 0}件 (想定: 20件)`)
  console.log(`brain_visit_retail_items.json: ${retailRows?.length ?? 0}件 (想定: 2件)`)
  console.log(`brain_subscription_payments.json: ${plannedSubscriptionPayments.length}件(書込み予定)`)
  console.log(`brain_menus.json: ${plannedNewMenuNames.size}件(作成予定): ${Array.from(plannedNewMenuNames).join(' / ')}`)
}

main().catch(e => { console.error(e); process.exit(1) })
