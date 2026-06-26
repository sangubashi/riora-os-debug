/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * csv-import-dry-run.ts — SalonBoard売上明細CSV dry-run(CLI検証用ツール)
 *
 * ⚠️ RETIRED (2026-06-21): profiles/staff_name_aliases前提の旧設計のCLIツール。
 * brain_*方針確定により下記import(staffResolver.ts)の型・関数シグネチャが
 * brain_staff.name_aliases(JSONB)前提へ変更されたため、本ファイルは
 * コンパイル不能(意図的・実行しないこと)。
 * 同等の機能は POST /api/admin/csv/dry-run (app/api/admin/csv/dry-run/route.ts)
 * が本番相当として置き換えている。本ファイルは履歴参照用にのみ残す。
 *
 * 目的(旧): 本番DBへの書き込みを一切行わず、CSVを解析して
 *   - 会計ID単位の集約結果
 *   - staff_name_aliases / profiles を使ったスタッフ解決結果
 *   - 顧客数・会計数・予約数（would-be reservation数）
 * をレポート出力する。
 *
 * 重要な制約:
 *   - 本スクリプトはSupabaseに対して SELECT のみ実行する（INSERT/UPDATE/UPSERT禁止）
 *   - migrationは未適用のままで実行する想定（staff_name_aliasesが存在しなくても動作する）
 *
 * 実行方法:
 *   npx ts-node scripts/csv-import-dry-run.ts [CSVファイルパス]
 *   （省略時は test-data/csv-import/salonboard_demo_sales_50customers.csv を使用）
 *
 * 設計根拠: docs/CSV_IMPORT_REAL_FORMAT_IMPLEMENTATION_DESIGN.md
 */

import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'
import * as iconv from 'iconv-lite'
import { createClient } from '@supabase/supabase-js'

import {
  parseSalonBoardDetailCsv,
  aggregateCheckouts,
  type CheckoutIssue,
  type SalonBoardCheckoutAggregate,
} from '../src/lib/import/salonBoardDetailParser'
import {
  buildStaffLookup,
  resolveStaffId,
  type StaffProfileRow,
  type StaffAliasRow,
} from '../src/lib/import/staffResolver'
import { toNameKey } from '../src/lib/import/normalizer'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const DEFAULT_CSV_PATH = path.join(
  'test-data', 'csv-import', 'salonboard_demo_sales_50customers.csv'
)

// ─── Supabase（service_role・読み取り専用）────────────────────────────────────

const url    = process.env.NEXT_PUBLIC_SUPABASE_URL
const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !svcKey) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です（.env.local）')
  process.exit(1)
}

// 本スクリプトはこのクライアントで .select() のみ実行する（書き込みメソッドは使用しない）
const db = createClient(url, svcKey, { auth: { persistSession: false } })

async function fetchProfiles(): Promise<StaffProfileRow[]> {
  const { data, error } = await db.from('profiles').select('id, staff_name, display_name')
  if (error) {
    console.error(`⚠️  profiles取得エラー: ${error.code} ${error.message}`)
    return []
  }
  return (data ?? []).map((r: any) => ({
    id:          r.id,
    staffName:   r.staff_name,
    displayName: r.display_name,
  }))
}

async function fetchStaffNameAliases(): Promise<{ rows: StaffAliasRow[]; tableExists: boolean }> {
  const { data, error } = await db.from('staff_name_aliases').select('alias, staff_id')
  if (error) {
    // PGRST205: テーブルがPostgRESTスキーマキャッシュに存在しない（=未適用migration想定どおり）
    if (error.code === 'PGRST205' || error.code === '42P01') {
      return { rows: [], tableExists: false }
    }
    console.error(`⚠️  staff_name_aliases取得エラー: ${error.code} ${error.message}`)
    return { rows: [], tableExists: false }
  }
  return {
    rows: (data ?? []).map((r: any) => ({ alias: r.alias, staffId: r.staff_id })),
    tableExists: true,
  }
}

// ─── レポート ─────────────────────────────────────────────────────────────────

interface DryRunReport {
  csvPath:           string
  generatedAt:       string
  totalDetailLines:  number
  totalCheckouts:    number
  validCheckouts:    number
  customerCount:     number
  wouldBeReservations: number
  staffNameAliasesTableExists: boolean
  staffResolution: {
    resolvedViaProfile: number
    resolvedViaAlias:   number
    unresolved:         { name: string; count: number; checkoutIds: string[] }[]
  }
  issues: CheckoutIssue[]
}

function printReport(r: DryRunReport) {
  console.log('\n========================================')
  console.log(' SalonBoard CSV dry-run レポート')
  console.log('========================================')
  console.log(`CSVファイル:        ${r.csvPath}`)
  console.log(`実行日時:           ${r.generatedAt}`)
  console.log(`明細行数:           ${r.totalDetailLines}`)
  console.log(`会計数（集約後）:    ${r.totalCheckouts}`)
  console.log(`  うちエラー無し:    ${r.validCheckouts}`)
  console.log(`顧客数（CSV内ユニーク）: ${r.customerCount}`)
  console.log(`予約候補数（reservations化可能）: ${r.wouldBeReservations}`)

  console.log('\n── staff_name_aliases ──')
  console.log(r.staffNameAliasesTableExists
    ? '✓ テーブル存在（migration適用済み想定）'
    : '⚠️  テーブル未存在（migration未適用のため想定どおり。profiles完全一致のみで解決）')

  console.log('\n── スタッフ解決結果 ──')
  console.log(`profilesで解決:      ${r.staffResolution.resolvedViaProfile}`)
  console.log(`staff_name_aliasesで解決: ${r.staffResolution.resolvedViaAlias}`)
  if (r.staffResolution.unresolved.length === 0) {
    console.log('未解決:              0（全件解決済み）')
  } else {
    console.log(`未解決:              ${r.staffResolution.unresolved.length}名分`)
    r.staffResolution.unresolved.forEach(u => {
      console.log(`  - "${u.name}"（${u.count}会計、会計ID例: ${u.checkoutIds.slice(0, 3).join(', ')}）`)
    })
  }

  const errors = r.issues.filter(i => i.severity === 'error')
  const warns  = r.issues.filter(i => i.severity === 'warn')
  console.log('\n── dry-runエラー/警告 ──')
  console.log(`error: ${errors.length}件 / warn: ${warns.length}件`)
  errors.slice(0, 20).forEach(e => console.log(`  [ERROR] 会計ID=${e.checkoutId} ${e.code}: ${e.message}`))
  warns.slice(0, 20).forEach(w => console.log(`  [WARN]  会計ID=${w.checkoutId} ${w.code}: ${w.message}`))
  if (errors.length > 20) console.log(`  ...他 ${errors.length - 20}件のerror`)
  if (warns.length > 20)  console.log(`  ...他 ${warns.length - 20}件のwarn`)

  console.log('\n========================================')
  console.log(errors.length === 0
    ? '✅ error 0件 — このCSVはPass A/B実装時にそのまま処理可能な状態です'
    : '❌ error あり — 本番実装時はこのCSVのまま書き込みを実行してはいけません')
  console.log('========================================\n')
}

// ─── メイン ───────────────────────────────────────────────────────────────────

async function main() {
  const csvPath = process.argv[2] ?? DEFAULT_CSV_PATH
  if (!fs.existsSync(csvPath)) {
    console.error(`❌ CSVファイルが見つかりません: ${csvPath}`)
    process.exit(1)
  }

  const buf = fs.readFileSync(csvPath)
  const csvText = iconv.decode(buf, 'Shift_JIS')

  const parsed = parseSalonBoardDetailCsv(csvText)
  const { aggregates, issues: aggregateIssues } = aggregateCheckouts(parsed.rows)
  const issues: CheckoutIssue[] = [...parsed.issues, ...aggregateIssues]

  const [profiles, aliasResult] = await Promise.all([
    fetchProfiles(),
    fetchStaffNameAliases(),
  ])
  const lookup = buildStaffLookup(profiles, aliasResult.rows)

  let resolvedViaProfile = 0
  let resolvedViaAlias   = 0
  const unresolvedMap = new Map<string, { count: number; checkoutIds: string[] }>()
  const validAggregates: SalonBoardCheckoutAggregate[] = []

  aggregates.forEach(a => {
    const resolution = resolveStaffId(a.staffNameRaw, lookup)
    if (resolution.status === 'resolved') {
      if (resolution.via === 'profile') resolvedViaProfile++
      else resolvedViaAlias++
      validAggregates.push(a)
    } else {
      const entry = unresolvedMap.get(resolution.normalized) ?? { count: 0, checkoutIds: [] }
      entry.count++
      entry.checkoutIds.push(a.checkoutId)
      unresolvedMap.set(resolution.normalized, entry)
      issues.push({
        checkoutId: a.checkoutId, code: 'unresolved_staff', severity: 'error',
        message: `スタッフ名を解決できません: "${a.staffNameRaw}"（正規化後: "${resolution.normalized}"）`,
      })
    }
  })

  const customerCount = new Set(aggregates.map(a => toNameKey(a.customerName))).size

  const report: DryRunReport = {
    csvPath,
    generatedAt: new Date().toISOString(),
    totalDetailLines: parsed.rows.length,
    totalCheckouts: aggregates.length,
    validCheckouts: aggregates.length - new Set(aggregateIssues.map(i => i.checkoutId)).size,
    customerCount,
    wouldBeReservations: validAggregates.length,
    staffNameAliasesTableExists: aliasResult.tableExists,
    staffResolution: {
      resolvedViaProfile,
      resolvedViaAlias,
      unresolved: Array.from(unresolvedMap.entries()).map(([name, v]) => ({ name, ...v })),
    },
    issues,
  }

  printReport(report)

  const reportPath = path.join('test-data', 'csv-import', 'dry-run-report.json')
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8')
  console.log(`レポートを書き出しました（ローカルファイル、DB書き込みではありません）: ${reportPath}`)
}

main().catch(err => {
  console.error('❌ dry-run実行エラー:', err)
  process.exit(1)
})
