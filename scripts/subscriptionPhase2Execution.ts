/**
 * subscriptionPhase2Execution.ts — サブスク決済分離Phase 2 + 基本メニュー名解決 統合実行スクリプト
 *
 * 対象: archive/salonboard-csv-source/salonboard_export_20260501-20260912_utf8.csv の
 * 342会計のうち、サブスク課金を含む136会計(純粋サブスク会計78 + 混在会計58)。
 *
 * 除外なし(2026-09-14最終確認): 吉田雅様2026-07-17(checkoutId=RB000562597711)・
 * 大西璃子様2026-08-30(checkoutId=RB000574660139)は個別確認待ちとして一時除外していたが、
 * 生CSV提示の上でユーザーが内容を確認し、同日複数会計の衝突ではなく単一会計として
 * 説明可能と判断されたため、除外を解除し136会計全てを対象に含める(EXCLUDED_CHECKOUT_IDSは
 * 空。将来また除外が必要になった場合のためだけに機構は残す)。
 *
 * 実施内容:
 *   1. 純粋サブスク会計(78件・同日複数会計の集約により実visit単位では74件):
 *      既存brain_visits行をsoft delete(deleted_at設定)し、brain_subscription_paymentsへ
 *      visit_id=nullで記録する。
 *   2. 混在会計(58件): 既存brain_visits行のtreatment_amountをサブスク分を除いた金額へ是正し、
 *      menu_idをBASE_TREATMENT_NAME_RESOLUTIONで解決した基本施術名へ再解決する
 *      (オプション行のみ・サブスク明細のみだった35件が対象。残り23件は元々実施術行が
 *      あり代表メニュー名は変わらないため、treatment_amountの是正のみ)。
 *      brain_subscription_paymentsへvisit_id付きで記録する。
 *   3. 1で対象になった顧客について、残存visitのvisit_count_atを来店日昇順で振り直す。
 *
 * 子テーブルへの影響(2026-09-14確認・今回は対応しない・ソフトデリートのみの方針):
 *   - brain_proposal_outcomes(20件が対象visitを参照): 集計クエリ(OutcomeRepo.ts)は
 *     brain_visitsとJOINせずcustomer_id/store_id等で直接検索するため、visitをsoft delete
 *     しても**そのまま見え続ける**(消えない)。visit_count_atは是正後の値に追従しないため、
 *     古い(是正前の)visit_count_atのまま残る。
 *   - brain_visit_retail_items(2件が対象visitを参照): 表示元
 *     (/api/customers/[id]/homecare-products)はbrain_visitsをdeleted_at IS NULLで
 *     絞り込んだvisit_idのみをIN句に使うため、soft delete後は**totalAmount集計から
 *     見えなくなる**(該当商品の累計金額が減る形で消える)。
 *
 * デフォルトはdry-run(DBへの書き込みは一切行わない)。実際に書き込むには
 * 明示的に --execute フラグを渡す必要がある。
 *
 * 使い方:
 *   Dry Run: npx ts-node --compiler-options "{\"module\":\"commonjs\"}" scripts/subscriptionPhase2Execution.ts
 *   本実行:  npx ts-node --compiler-options "{\"module\":\"commonjs\"}" scripts/subscriptionPhase2Execution.ts --execute
 */
import * as fs from 'fs'
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

const EXECUTE = process.argv.includes('--execute')
const CSV_PATH = 'archive/salonboard-csv-source/salonboard_export_20260501-20260912_utf8.csv'
// 2026-09-14最終確認: 生CSV提示の上でユーザーが内容を確認し除外解除。空のまま運用する。
const EXCLUDED_CHECKOUT_IDS = new Set<string>([])

function dateOnly(iso: string): string { return iso.slice(0, 10) }

function isPureSubscriptionCheckout(agg: SalonBoardCheckoutAggregate): boolean {
  return agg.subscriptionPayments.length > 0 && agg.treatmentLineCount === 0 && agg.retailSales === 0
}

interface PlannedDeletion {
  checkoutId: string
  customerName: string
  visitDate: string
  visitId: string
  oldTreatmentAmount: number
}

interface PlannedCorrection {
  checkoutId: string
  customerName: string
  visitDate: string
  visitId: string
  oldTreatmentAmount: number
  newTreatmentAmount: number
  oldMenuId: string
  newMenuId: string | null // 新規作成が必要な場合はdry-run時点でnull
  newMenuName: string
  menuNameChanged: boolean
}

interface RenumberPlan {
  customerName: string
  customerId: string
  changes: { visitId: string; visitDate: string; oldVisitCountAt: number; newVisitCountAt: number }[]
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

  const targetAggregates = allAggregates.filter(
    a => a.subscriptionPayments.length > 0 && !EXCLUDED_CHECKOUT_IDS.has(a.checkoutId)
  )
  const excludedAggregates = allAggregates.filter(
    a => a.subscriptionPayments.length > 0 && EXCLUDED_CHECKOUT_IDS.has(a.checkoutId)
  )
  const batchHistoryByCustomerName = buildBatchHistoryByCustomer(targetAggregates)

  const [existingCustomers, staff, menus] = await Promise.all([
    repos.customerRepo.listByStore(DEMO_STORE_ID),
    repos.staffRepo.listByStore(DEMO_STORE_ID),
    repos.menuRepo.listByStore(DEMO_STORE_ID),
  ])
  const staffLookup = buildStaffLookup(staff.map(s => ({ id: s.id, name: s.name, nameAliases: s.nameAliases })))
  const menuLookup = buildMenuLookup(menus)

  // CHECKOUT_ID_FOUNDATION_1(既知の制約): brain_visitsはcustomer_id+visit_dateでしか
  // 既存行を特定できないため、同一顧客・同日に複数のCSV会計IDが存在する場合(サブスクの
  // 決済取消+再決済等)、それらは全て同じexistingVisitへ解決される。deletions/corrections
  // はvisitId単位で1件に集約し(重複書き込み防止)、何件のCSV会計が集約されたかを記録する。
  const deletionsRaw: PlannedDeletion[] = []
  const correctionsRaw: PlannedCorrection[] = []
  const unmatched: { checkoutId: string; customerName: string; visitDate: string; reason: string }[] = []

  for (const agg of targetAggregates) {
    const visitDate = dateOnly(agg.visitDateTime)
    const nameCandidates = findNameCandidates(agg.customerName, existingCustomers)
    if (nameCandidates.length === 0) {
      unmatched.push({ checkoutId: agg.checkoutId, customerName: agg.customerName, visitDate, reason: 'no_name_candidate' })
      continue
    }

    // 候補の中から当該日付にsalonboard_import来店を持つ顧客を特定する
    // (重複顧客レコード対策: 実績のあるIDが自然に一致するため、空のスタブ顧客とは衝突しない)。
    let matchedCustomer: Customer | null = null
    let existingVisit: Awaited<ReturnType<typeof repos.visitRepo.findByCustomerAndDate>> = null
    for (const c of nameCandidates) {
      const v = await repos.visitRepo.findByCustomerAndDate(c.customerId, visitDate)
      if (v) {
        matchedCustomer = existingCustomers.find(ec => ec.id === c.customerId) ?? null
        existingVisit = v
        break
      }
    }
    if (!matchedCustomer || !existingVisit) {
      unmatched.push({ checkoutId: agg.checkoutId, customerName: agg.customerName, visitDate, reason: 'no_existing_visit' })
      continue
    }
    if (existingVisit.source !== 'salonboard_import') {
      unmatched.push({ checkoutId: agg.checkoutId, customerName: agg.customerName, visitDate, reason: `existing_visit_source_${existingVisit.source}` })
      continue
    }

    const isPure = isPureSubscriptionCheckout(agg)

    if (isPure) {
      deletionsRaw.push({
        checkoutId: agg.checkoutId, customerName: agg.customerName, visitDate,
        visitId: existingVisit.id, oldTreatmentAmount: existingVisit.treatmentAmount,
      })
      continue
    }

    // 混在会計: treatment_amountの是正 + 基本メニュー名の再解決
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

    const menuNameChanged = resolvedBaseTreatmentName !== '' // baseTreatmentLine由来(source='treatment_line')は常に変化なし想定
      && agg.baseTreatmentNameSource !== 'treatment_line'

    // BASE_TREATMENT_NAME_RESOLUTION: サブスク履歴から解決したコース名(「選べる肌改善コース」
    // 「ヒト幹細胞ベーシック」等)は治療メニューそのものの名前ではなく契約プラン名のため、
    // resolveMenuId()の4方式一致(exact/normalized/partial/keyword_match)には通さない。
    // 通してしまうと、例えば「ヒト幹細胞ベーシック」がkeyword_match(共通キーワード「ヒト幹」)で
    // 無関係な実メニュー「ヒト幹15000」に紐付いてしまう(実データ確認済み・意図しない混同)。
    // 常に専用のimported_other行を再利用/新規作成する(fallback専用経路)。
    let newMenuId: string | null = existingVisit.menuId
    if (menuNameChanged) {
      if (EXECUTE) {
        const existing = menuLookup.fallbackByRawName.get(resolvedBaseTreatmentName)
        if (existing) {
          newMenuId = existing.id
        } else {
          const created = await repos.menuRepo.create({
            storeId: DEMO_STORE_ID, name: resolvedBaseTreatmentName, price: 0, role: 'imported_other', targetTypes: [],
          })
          menuLookup.fallbackByRawName.set(resolvedBaseTreatmentName, { id: created.id, name: created.name })
          newMenuId = created.id
        }
      } else {
        const preview = previewFallbackMenu(resolvedBaseTreatmentName, menuLookup)
        newMenuId = preview.menuId // nullの場合は新規作成が必要(wouldCreate=true)
      }
    }

    correctionsRaw.push({
      checkoutId: agg.checkoutId, customerName: agg.customerName, visitDate,
      visitId: existingVisit.id,
      oldTreatmentAmount: existingVisit.treatmentAmount,
      newTreatmentAmount: Math.max(0, agg.netServiceSales),
      oldMenuId: existingVisit.menuId,
      newMenuId,
      newMenuName: menuNameChanged ? resolvedBaseTreatmentName : (menus.find(m => m.id === existingVisit!.menuId)?.name ?? ''),
      menuNameChanged,
    })
  }

  // ── 同一visitId(同一顧客・同日に複数CSV会計が存在するケース)を1件に集約 ─────
  // deletions: どのCSV会計を採用しても「このvisitは削除する」という結論は同じため、
  // 最初の1件を残す。corrections: 実際の来店1回分の合算値をCSV側で復元できないため
  // (旧パイプラインもcustomer_id+visit_dateでしか突合できず、後から処理された会計の
  // 値で上書きしていた=既存のCHECKOUT_ID_FOUNDATION_1の制約と同じ)、CSV内の最後の
  // 会計(行番号が最も大きいもの=旧パイプラインの処理順と同じ)を採用する。
  function dedupeByVisitId<T extends { visitId: string }>(items: T[]): { deduped: T[]; collapsedCount: number } {
    const byVisitId = new Map<string, T>()
    for (const item of items) byVisitId.set(item.visitId, item) // 後勝ち
    return { deduped: Array.from(byVisitId.values()), collapsedCount: items.length - byVisitId.size }
  }
  const { deduped: deletions, collapsedCount: deletionsCollapsed } = dedupeByVisitId(deletionsRaw)
  const { deduped: corrections, collapsedCount: correctionsCollapsed } = dedupeByVisitId(correctionsRaw)

  // ── visit_count_at 振り直し計画(純粋サブスク会計を削除した顧客のみ) ──────────
  const affectedCustomerIds = Array.from(new Set(deletions.map(d => {
    const c = existingCustomers.find(ec => ec.name === d.customerName)
    return c?.id
  }).filter((x): x is string => !!x)))

  const renumberPlans: RenumberPlan[] = []
  for (const customerId of affectedCustomerIds) {
    const customer = existingCustomers.find(c => c.id === customerId)
    if (!customer) continue
    const allVisits = await repos.visitRepo.recentByCustomer(customerId, 1000) // deleted_at IS NULLのみ返る想定
    const deletedIdsForCustomer = new Set(
      deletions.filter(d => existingCustomers.find(ec => ec.name === d.customerName)?.id === customerId).map(d => d.visitId)
    )
    const remaining = allVisits
      .filter(v => !deletedIdsForCustomer.has(v.id))
      .slice()
      .sort((a, b) => a.visitDate.localeCompare(b.visitDate))

    const changes: RenumberPlan['changes'] = []
    remaining.forEach((v, idx) => {
      const newCount = idx + 1
      if (v.visitCountAt !== newCount) {
        changes.push({ visitId: v.id, visitDate: v.visitDate, oldVisitCountAt: v.visitCountAt, newVisitCountAt: newCount })
      }
    })
    if (changes.length > 0) renumberPlans.push({ customerName: customer.name, customerId, changes })
  }

  // ── 子テーブル(soft delete対象visitを参照するレコード)への影響確認 ──────────
  const deletionVisitIds = deletions.map(d => d.visitId)
  const childTableCounts: Record<string, number> = {}
  if (deletionVisitIds.length > 0) {
    const childTables = [
      'brain_skin_records', 'brain_proposal_outcomes', 'brain_evaluation_queue',
      'brain_pattern_fire_log', 'brain_customer_photos', 'brain_product_proposals',
      'brain_staff_proposals', 'brain_visit_retail_items',
    ]
    for (const table of childTables) {
      const { count, error } = await raw.from(table).select('id', { count: 'exact', head: true }).in('visit_id', deletionVisitIds)
      if (!error) childTableCounts[table] = count ?? 0
    }
  }

  // ── レポート出力 ──────────────────────────────────────────────────────────
  console.log(`=== モード: ${EXECUTE ? '本実行(書き込みあり)' : 'Dry Run(書き込みなし)'} ===`)
  console.log(`除外checkoutId: ${Array.from(EXCLUDED_CHECKOUT_IDS).join(', ')} (${excludedAggregates.length}件)`)
  console.log(`\n対象CSV会計${targetAggregates.length}件 → 実visit単位で純粋サブスク会計=${deletions.length}件 / 混在会計是正=${corrections.length}件 / マッチ不能=${unmatched.length}件`)
  if (deletionsCollapsed > 0) console.log(`  (同一顧客・同日の複数会計IDが${deletionsCollapsed}件、既存の同一visitへ集約されました)`)
  if (correctionsCollapsed > 0) console.log(`  (混在会計側でも${correctionsCollapsed}件、同一visitへ集約されました)`)

  console.log('\n--- ① 純粋サブスク会計: visit soft delete対象 ---')
  deletions.forEach(d => console.log(`  ${d.customerName} ${d.visitDate} (旧treatment_amount=${d.oldTreatmentAmount}円) visitId=${d.visitId}`))

  console.log('\n--- ② 混在会計: treatment_amount是正 + menu_id再解決 ---')
  const menuChanged = corrections.filter(c => c.menuNameChanged)
  const amountOnlyChanged = corrections.filter(c => !c.menuNameChanged)
  console.log(`  うちmenu_id再解決あり: ${menuChanged.length}件 / treatment_amountのみ是正: ${amountOnlyChanged.length}件`)
  corrections.forEach(c => {
    const menuPart = c.menuNameChanged ? ` menu:"${c.newMenuName}"(${c.newMenuId ?? '要新規作成'})` : ''
    console.log(`  ${c.customerName} ${c.visitDate}: treatment_amount ${c.oldTreatmentAmount}→${c.newTreatmentAmount}円${menuPart}`)
  })

  if (unmatched.length > 0) {
    console.log('\n--- マッチ不能(要個別確認) ---')
    unmatched.forEach(u => console.log(`  ${u.customerName} ${u.visitDate} (checkout=${u.checkoutId}): ${u.reason}`))
  }

  console.log('\n--- ③ visit_count_at 振り直し計画 ---')
  console.log(`対象顧客: ${renumberPlans.length}名`)
  renumberPlans.forEach(p => {
    console.log(`  ${p.customerName}:`)
    p.changes.forEach(c => console.log(`    visitId=${c.visitId} (${c.visitDate}): ${c.oldVisitCountAt} → ${c.newVisitCountAt}`))
  })

  console.log('\n--- ④ soft delete対象visitを参照する子テーブル件数(参考・今回は対応しない) ---')
  Object.entries(childTableCounts).forEach(([table, count]) => {
    if (count > 0) console.log(`  ${table}: ${count}件`)
  })
  if (Object.values(childTableCounts).every(c => c === 0)) console.log('  該当なし')

  if (!EXECUTE) {
    console.log('\n=== Dry Runのみ。--execute を付けて実行するまでDBへの書き込みは一切行われません。 ===')
    return
  }

  // ── 本実行 ──────────────────────────────────────────────────────────────
  console.log('\n=== 本実行を開始します ===')

  for (const d of deletions) {
    const { error } = await raw.from('brain_visits').update({ deleted_at: new Date().toISOString() }).eq('id', d.visitId)
    if (error) throw new Error(`soft delete failed for ${d.visitId}: ${error.message}`)
  }
  console.log(`✓ ${deletions.length}件のvisitをsoft delete`)

  for (const c of corrections) {
    if (c.newMenuId === null) {
      console.warn(`  ⚠ menu_id未解決のためスキップ: ${c.customerName} ${c.visitDate}`)
      continue
    }
    const { error } = await raw.from('brain_visits')
      .update({ treatment_amount: c.newTreatmentAmount, menu_id: c.newMenuId })
      .eq('id', c.visitId)
    if (error) throw new Error(`correction failed for ${c.visitId}: ${error.message}`)
  }
  console.log(`✓ ${corrections.length}件のvisitのtreatment_amount/menu_idを是正`)

  for (const p of renumberPlans) {
    for (const c of p.changes) {
      const { error } = await raw.from('brain_visits').update({ visit_count_at: c.newVisitCountAt }).eq('id', c.visitId)
      if (error) throw new Error(`renumber failed for ${c.visitId}: ${error.message}`)
    }
  }
  console.log(`✓ ${renumberPlans.reduce((s, p) => s + p.changes.length, 0)}件のvisit_count_atを振り直し`)

  // ── brain_subscription_payments書込み(純粋・混在の両方) ──────────────────
  for (const agg of targetAggregates) {
    const visitDate = dateOnly(agg.visitDateTime)
    const nameCandidates = findNameCandidates(agg.customerName, existingCustomers)
    let matchedCustomer: Customer | null = null
    for (const c of nameCandidates) {
      const v = await repos.visitRepo.findByCustomerAndDate(c.customerId, visitDate)
      if (v) { matchedCustomer = existingCustomers.find(ec => ec.id === c.customerId) ?? null; break }
    }
    if (!matchedCustomer) continue
    const staffRes = resolveStaffId(agg.staffNameRaw, staffLookup)
    if (staffRes.status === 'unresolved') continue
    const isPure = isPureSubscriptionCheckout(agg)
    const correction = corrections.find(c => c.checkoutId === agg.checkoutId)
    const visitId = isPure ? null : (correction?.visitId ?? null)

    await repos.subscriptionPaymentRepo.replaceForCheckout(
      agg.checkoutId,
      agg.subscriptionPayments.map(p => ({
        storeId: DEMO_STORE_ID, customerId: matchedCustomer!.id, visitId,
        staffId: staffRes.staffId, itemName: p.itemName, amount: p.amount, paymentDate: visitDate,
      }))
    )
  }
  console.log(`✓ brain_subscription_paymentsを${targetAggregates.length}会計分記録`)

  console.log('\n=== 本実行完了 ===')
}

main().catch(e => { console.error(e); process.exit(1) })
