import { config } from 'dotenv'
config({ path: '.env.local' })

import { readFileSync } from 'fs'
import { decodeCsvBuffer } from '../src/lib/import/csvEncoding'
import { parseSalonBoardDetailCsv, aggregateCheckouts } from '../src/lib/import/salonBoardDetailParser'
import { sanitizeResidualPii, hashExternalKey } from '../src/lib/import/piiSanitizer'
import { buildStaffLookup, resolveStaffId } from '../src/lib/import/staffResolver'
import { buildMenuLookup, resolveMenuId } from '../src/lib/import/menuResolver'
import { findNameCandidates, decideCustomerMatch } from '../src/lib/import/customerMatcher'
import { getRepos } from '../app/lib/repos'

const STORE_ID = '00000000-0000-0000-0000-000000000001'
const FILE_PATH = 'C:/Users/user/Desktop/サロンボード/売上明細_20260619145911.csv'

function dateOnly(iso: string): string {
  return iso.slice(0, 10)
}

async function main() {
  const buf = readFileSync(FILE_PATH)
  const csvText = decodeCsvBuffer(buf)

  const parsed = parseSalonBoardDetailCsv(csvText)
  const fatal = parsed.issues.find(i => ['empty_csv', 'missing_required_columns'].includes(i.code))
  if (fatal) {
    console.log('FATAL:', fatal.code, fatal.message)
    process.exit(1)
  }

  let piiFoundTotal = 0
  const sanitizedRows = parsed.rows.map(row => {
    const { clean, piiFound } = sanitizeResidualPii(row)
    piiFoundTotal += piiFound
    return clean
  })

  const { aggregates, issues: aggIssues } = aggregateCheckouts(sanitizedRows)
  const parseLevelErrorCount = parsed.issues.filter(i => i.severity === 'error').length
  const aggLevelErrorCount = aggIssues.filter(i => i.severity === 'error').length

  const repos = getRepos()
  const [store, staff, menus, existingCustomers] = await Promise.all([
    repos.storeRepo.findById(STORE_ID),
    repos.staffRepo.listByStore(STORE_ID),
    repos.menuRepo.listByStore(STORE_ID),
    repos.customerRepo.listByStore(STORE_ID),
  ])
  if (!store) throw new Error('store_not_found')

  const byExternalHash = new Map<string, any>()
  existingCustomers.forEach((c: any) => { if (c.externalKeyHash) byExternalHash.set(c.externalKeyHash, c) })

  const staffLookup = buildStaffLookup(staff.map((s: any) => ({ id: s.id, name: s.name, nameAliases: s.nameAliases })))
  const menuLookup = buildMenuLookup(menus)

  let staffResolved = 0
  let staffUnresolved = 0
  let menuMatched = 0
  let menuFallback = 0
  let menuUnresolved = 0
  let customerNew = 0
  let customerMatched = 0
  let customerNeedsReview = 0

  for (const agg of aggregates) {
    const staffRes = resolveStaffId(agg.staffNameRaw, staffLookup)
    if (staffRes.status === 'resolved') staffResolved += 1
    else staffUnresolved += 1

    const menuRes = resolveMenuId(agg.menuName, menuLookup)
    if (menuRes.status === 'matched') menuMatched += 1
    else if (menuRes.status === 'fallback') menuFallback += 1
    else { menuUnresolved += 1; continue }

    const hash = agg.customerNumber ? hashExternalKey(agg.customerNumber, store.anonSalt) : null
    const matchedByHash = hash ? byExternalHash.get(hash) ?? null : null
    const nameCandidates = matchedByHash ? [] : findNameCandidates(agg.customerName, existingCustomers)
    const decision = decideCustomerMatch({ matchedByHash, nameCandidates })

    if (decision.status === 'matched') customerMatched += 1
    else if (decision.status === 'new') customerNew += 1
    else customerNeedsReview += 1
  }

  const totalRows = parsed.totalLines
  const totalAggregates = aggregates.length
  const skippedAtParseOrAgg = parseLevelErrorCount + aggLevelErrorCount
  const skippedTotal = skippedAtParseOrAgg + menuUnresolved
  const importable = customerMatched + customerNew

  console.log('=== 件数レポート ===')
  console.log(`総行数(totalRows)          : ${totalRows}`)
  console.log(`会計集約後件数(checkouts)   : ${totalAggregates}`)
  console.log(`成功件数(importable)        : ${importable}`)
  console.log(`スキップ件数(skipped)        : ${skippedTotal}  (parse/agg起因=${skippedAtParseOrAgg}, menu未解決=${menuUnresolved})`)
  console.log(`スキップ率                   : ${((skippedTotal / totalAggregates) * 100).toFixed(1)}%`)
  console.log(`imported_other件数(menu fallback) : ${menuFallback}`)
  console.log(`新規顧客件数(customer=new)    : ${customerNew}`)
  console.log(`既存顧客マッチ件数(matched)   : ${customerMatched}`)
  console.log(`要レビュー件数(needs_review)  : ${customerNeedsReview}`)
  console.log(`staff_alias解決件数(resolved) : ${staffResolved}`)
  console.log(`staff未解決件数(unresolved)   : ${staffUnresolved}`)
  console.log(`PII検出件数                   : ${piiFoundTotal}`)
}

main()
