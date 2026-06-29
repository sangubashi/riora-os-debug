/**
 * csv-import-run.ts — brain_* アーキテクチャ本番 CSV Import 実行スクリプト
 *
 * 実行:
 *   npx ts-node --project tsconfig.scripts.json --transpile-only scripts/csv-import-run.ts [CSVパス]
 *
 * ⚠️ INSERT/UPDATE を実行します。Dry Run 確認後に実行してください。
 */

import * as fs   from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'
import * as iconv  from 'iconv-lite'
import { createClient } from '@supabase/supabase-js'

import { runImportPipeline, type PipelineRepos } from '../src/lib/import/csvImportPipeline'
import { CustomerRepo } from '../src/repositories/supabase/CustomerRepo'
import { VisitRepo }    from '../src/repositories/supabase/VisitRepo'
import { StaffRepo }    from '../src/repositories/supabase/StaffRepo'
import { MenuRepo }     from '../src/repositories/supabase/MenuRepo'
import { StoreRepo }    from '../src/repositories/supabase/StoreRepo'
import { OpsLogRepo }   from '../src/repositories/supabase/OpsLogRepo'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const STORE_ID = process.env.DEMO_STORE_ID ?? '00000000-0000-0000-0000-000000000001'

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
  const buf  = fs.readFileSync(filePath)
  const utf8 = buf.toString('utf-8').replace(/^﻿/, '')
  if (!utf8.includes('�') && utf8.includes('会計ID')) return utf8
  const sjis = iconv.decode(buf, 'Shift_JIS')
  return sjis.includes('会計ID') ? sjis : utf8
}

async function main() {
  const csvPath = process.argv[2] ?? 'test-data/csv-import/salonboard_test_real_fixed.csv'

  if (!fs.existsSync(csvPath)) {
    console.error(`❌ ファイルが見つかりません: ${csvPath}`)
    process.exit(1)
  }

  const fileName = path.basename(csvPath)
  const csvText  = decodeCsv(csvPath)
  const repos    = buildRepos()

  console.log(`\n${'═'.repeat(60)}`)
  console.log(` 本番 Import: ${fileName}`)
  console.log(` Store: ${STORE_ID}`)
  console.log(`${'═'.repeat(60)}`)
  console.log(` ⚠️  INSERT/UPDATE を実行します...`)
  console.log()

  const result = await runImportPipeline(
    { storeId: STORE_ID, csvText, reviewDecisions: {} },
    repos,
  )

  if (!result.ok) {
    console.error(`❌ パイプラインエラー: [${result.code}] ${result.message}`)
    process.exit(1)
  }

  const r = result.report

  console.log('【インポート結果】')
  console.log(`  新規顧客 (brain_customers INSERT) : ${r.newCustomers} 件`)
  console.log(`  更新顧客 (brain_customers UPDATE) : ${r.updatedCustomers} 件`)
  console.log(`  来店記録 (brain_visits INSERT)    : ${r.visitsImported} 件`)
  console.log(`  未解決スタッフによるスキップ       : ${r.unresolvedStaffCount} 件`)
  console.log(`  残存 PII 検出数                   : ${r.piiFoundTotal} 件`)
  console.log(`  処理時間                           : ${r.durationMs} ms`)

  if (r.menuResolution) {
    const mr = r.menuResolution
    console.log(`\n【メニュー解決】`)
    console.log(`  完全一致           : ${mr.exactMatch} 件`)
    console.log(`  正規化一致         : ${mr.normalizedMatch} 件`)
    console.log(`  部分一致           : ${mr.partialMatch} 件`)
    console.log(`  fallback_other     : ${mr.fallbackOther} 件 (imported_other)`)
    console.log(`  未解決スキップ     : ${mr.unresolved} 件`)
  }

  if (r.qualityReport) {
    const qr = r.qualityReport
    console.log(`\n【品質スコア】`)
    console.log(`  スコア             : ${qr.score} / 100 (${qr.level})`)
    console.log(`  顧客解決率         : ${(qr.rates.customerResolutionRate * 100).toFixed(1)}%`)
    console.log(`  スタッフ解決率     : ${(qr.rates.staffResolutionRate * 100).toFixed(1)}%`)
    console.log(`  メニュー解決率     : ${(qr.rates.menuResolutionRate * 100).toFixed(1)}%`)
    console.log(`  imported_other 率  : ${(qr.rates.importedOtherRate * 100).toFixed(1)}%`)
  }

  console.log(`\n${'═'.repeat(60)}`)
  console.log(` ✅ Import 完了`)
  console.log(`${'═'.repeat(60)}\n`)
}

main().catch(err => {
  console.error('❌ Import 実行エラー:', err)
  process.exit(1)
})
