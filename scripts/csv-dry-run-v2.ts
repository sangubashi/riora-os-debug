/**
 * csv-dry-run-v2.ts — brain_* アーキテクチャ対応 CSV Dry Run CLI
 *
 * 目的: 本番DBへの書き込みを一切行わず、CSVを解析して
 *   - 新規顧客候補数 / 更新顧客候補数 / 重複候補数
 *   - imported_other (fallback) 数
 *   - エラー / 警告数
 * をレポート出力する。
 *
 * 実行:
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/csv-dry-run-v2.ts [CSVパス]
 *   省略時は test-data/csv-import/ の 3 ファイルを順に処理。
 *
 * ⚠️ SELECT のみ。INSERT/UPDATE は一切実行しない。
 */

import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'
import * as iconv from 'iconv-lite'
import { createClient } from '@supabase/supabase-js'

import { buildDryRunResult, type PipelineRepos } from '../src/lib/import/csvImportPipeline'
import { CustomerRepo }  from '../src/repositories/supabase/CustomerRepo'
import { VisitRepo }     from '../src/repositories/supabase/VisitRepo'
import { StaffRepo }     from '../src/repositories/supabase/StaffRepo'
import { MenuRepo }      from '../src/repositories/supabase/MenuRepo'
import { StoreRepo }     from '../src/repositories/supabase/StoreRepo'
import { OpsLogRepo }    from '../src/repositories/supabase/OpsLogRepo'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const STORE_ID = process.env.DEMO_STORE_ID ?? '00000000-0000-0000-0000-000000000001'

const CSV_TARGETS = [
  'test-data/csv-import/salonboard_demo_sales_50customers.csv',
  'test-data/csv-import/salonboard_test_real_fixed.csv',
  'test-data/csv-import/salonboard_test_real.csv',
]

// ─── Supabase (service_role, SELECT のみ) ────────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

function buildRepos(): PipelineRepos {
  return {
    customerRepo: new CustomerRepo(supabase) as never,
    visitRepo:    new VisitRepo(supabase)    as never,
    staffRepo:    new StaffRepo(supabase)    as never,
    menuRepo:     new MenuRepo(supabase)     as never,
    storeRepo:    new StoreRepo(supabase)    as never,
    opsLogRepo:   new OpsLogRepo(supabase)   as never,
  }
}

function decodeCsv(filePath: string): string {
  const buf = fs.readFileSync(filePath)
  const utf8 = buf.toString('utf-8').replace(/^﻿/, '')
  if (!utf8.includes('�') && utf8.includes('会計ID')) return utf8
  const sjis = iconv.decode(buf, 'Shift_JIS')
  return sjis.includes('会計ID') ? sjis : utf8
}

async function runDryRun(csvPath: string, repos: PipelineRepos) {
  if (!fs.existsSync(csvPath)) {
    console.log(`  ⚠️  ファイル不存在: ${csvPath}`)
    return
  }

  const csvText  = decodeCsv(csvPath)
  const fileName = path.basename(csvPath)

  console.log(`\n${'═'.repeat(60)}`)
  console.log(` Dry Run: ${fileName}`)
  console.log(`${'═'.repeat(60)}`)

  const result = await buildDryRunResult({ storeId: STORE_ID, fileName, csvText }, repos)

  if (!result.ok) {
    console.log(`  ❌ パースエラー: [${(result as {ok:false;code:string;message:string}).code}] ${(result as {ok:false;code:string;message:string}).message}`)
    return
  }

  const r = result.result

  // ── 基本統計 ────────────────────────────────────────────────────────────────
  console.log(`\n【基本統計】`)
  console.log(`  総行数（CSV明細）    : ${r.totalRows}`)
  console.log(`  インポート可能件数   : ${r.importable}`)
  console.log(`  スキップ件数         : ${r.skipped.length}`)
  console.log(`  要確認（重複候補）   : ${r.needsReview.length}`)

  const qr = r.qualityReport

  // ── 顧客マッチング ──────────────────────────────────────────────────────────
  console.log(`\n【顧客マッチング】`)
  if (qr?.rates) {
    console.log(`  会員番号マッチ率     : ${(qr.rates.customerResolutionRate * 100).toFixed(1)}%`)
    console.log(`  重複顧客リスク氏名   : ${qr.duplicateCustomerNames?.length ?? 0} 件`)
  }
  console.log(`  要レビュー（重複候補）: ${r.needsReview.length} 件`)
  r.needsReview.slice(0, 5).forEach(n => {
    console.log(`    行${n.rowNumber}: "${n.customerName}" ← 候補: "${n.candidateMatchName}"`)
  })
  if (r.needsReview.length > 5) {
    console.log(`    ...他 ${r.needsReview.length - 5} 件`)
  }

  // ── スタッフ解決 ─────────────────────────────────────────────────────────────
  console.log(`\n【スタッフ解決】`)
  if (r.unresolvedStaff.length === 0) {
    console.log(`  ✅ 全スタッフ解決済み`)
  } else {
    console.log(`  ❌ 未解決スタッフ: ${r.unresolvedStaff.length} 名`)
    r.unresolvedStaff.forEach(u => {
      console.log(`    - "${u.rawName}" (正規化: "${u.normalized}", ${u.occurrenceCount}件)`)
    })
  }

  // ── メニュー解決 ─────────────────────────────────────────────────────────────
  console.log(`\n【メニュー解決】`)
  if (qr?.menuResolution) {
    const mr = qr.menuResolution
    console.log(`  完全一致            : ${mr.exactMatch} 件`)
    console.log(`  正規化一致          : ${mr.normalizedMatch} 件`)
    console.log(`  部分一致            : ${mr.partialMatch} 件`)
    console.log(`  fallback_other(imported_other): ${mr.fallbackOther} 件`)
    console.log(`  未解決(スキップ)    : ${mr.unresolved} 件`)
  } else if (r.skipped.length > 0) {
    const checkoutErrors = r.skipped.filter(s => s.reasonCode === 'checkout_integrity_error')
    console.log(`  メニュー未解決スキップ: ${checkoutErrors.length} 件`)
  }

  // ── 品質レポート ─────────────────────────────────────────────────────────────
  if (qr) {
    console.log(`\n【品質スコア】`)
    console.log(`  会計数（集約後）    : ${qr.totalCheckouts} 件`)
    console.log(`  品質スコア          : ${qr.score} / 100 (${qr.level})`)
    console.log(`  顧客解決率          : ${(qr.rates.customerResolutionRate * 100).toFixed(1)}%`)
    console.log(`  スタッフ解決率      : ${(qr.rates.staffResolutionRate * 100).toFixed(1)}%`)
    console.log(`  メニュー解決率      : ${(qr.rates.menuResolutionRate * 100).toFixed(1)}%`)
    console.log(`  imported_other 率   : ${(qr.rates.importedOtherRate * 100).toFixed(1)}%`)
    if (qr.warnings.length > 0) {
      console.log(`  警告:`)
      qr.warnings.forEach(w => {
        console.log(`    [${w.severity.toUpperCase()}] ${w.type}: ${w.message} (${w.count}件)`)
      })
    }
  }

  // ── PII ─────────────────────────────────────────────────────────────────────
  console.log(`\n【PII検査】`)
  console.log(`  残存PII検出数        : ${r.piiFoundTotal} 件`)
  if (r.droppedColumns.length > 0) {
    console.log(`  DROPされたPII列     : ${r.droppedColumns.join(', ')}`)
  }
  if (r.unknownColumns.length > 0) {
    console.log(`  未知列（要確認）    : ${r.unknownColumns.join(', ')}`)
  }

  // ── スキップ詳細 ────────────────────────────────────────────────────────────
  if (r.skipped.length > 0) {
    console.log(`\n【スキップ詳細】`)
    const byCode: Record<string, number> = {}
    r.skipped.forEach(s => { byCode[s.reasonCode] = (byCode[s.reasonCode] ?? 0) + 1 })
    Object.entries(byCode).forEach(([code, cnt]) => {
      console.log(`  ${code}: ${cnt} 件`)
    })
  }

  // ── プレビュー ───────────────────────────────────────────────────────────────
  console.log(`\n【プレビュー（先頭3件）】`)
  r.preview.forEach(p => {
    console.log(`  ${p.name} | 性別:${p.gender ?? '-'} | 初回:${p.firstVisitDate ?? '-'}`)
  })

  // ── 総評 ────────────────────────────────────────────────────────────────────
  console.log(`\n【総評】`)
  const errCount = r.skipped.length
  const warnStaff = r.unresolvedStaff.length
  if (errCount === 0 && warnStaff === 0) {
    console.log(`  ✅ エラー 0件 / 未解決スタッフ 0件 — 本番インポート実行可`)
  } else {
    if (warnStaff > 0) console.log(`  ⚠️  未解決スタッフ ${warnStaff}名 → brain_staff のエイリアス登録が必要`)
    if (errCount > 0)  console.log(`  ❌ スキップ ${errCount}件 → インポート前に確認が必要`)
  }
}

async function main() {
  const targets = process.argv[2]
    ? [process.argv[2]]
    : CSV_TARGETS

  const repos = buildRepos()

  for (const csvPath of targets) {
    await runDryRun(csvPath, repos)
  }

  console.log(`\n${'═'.repeat(60)}`)
  console.log(` Dry Run 完了 — DB への書き込みは一切実行していません`)
  console.log(`${'═'.repeat(60)}\n`)
}

main().catch(err => {
  console.error('❌ Dry Run 実行エラー:', err)
  process.exit(1)
})
