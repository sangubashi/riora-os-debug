/**
 * run-customer-type.ts — 全顧客の CustomerType を再計算し brain_customers に保存
 *
 * 実行:
 *   npx ts-node --project tsconfig.scripts.json --transpile-only scripts/run-customer-type.ts
 *
 * 既に customer_type が設定済みの顧客はスキップ（上書きしない）。
 */

import * as dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

import { runCustomerTypeClassification } from '../src/lib/customerType/runCustomerTypeClassification'
import { CustomerRepo } from '../src/repositories/supabase/CustomerRepo'
import { VisitRepo }    from '../src/repositories/supabase/VisitRepo'
import { MenuRepo }     from '../src/repositories/supabase/MenuRepo'

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

async function main() {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(` CustomerType 再計算`)
  console.log(` Store: ${STORE_ID}`)
  console.log(`${'═'.repeat(60)}`)

  const summary = await runCustomerTypeClassification(STORE_ID, {
    customerRepo: new CustomerRepo(supabase) as never,
    visitRepo:    new VisitRepo(supabase)    as never,
    menuRepo:     new MenuRepo(supabase)     as never,
  })

  console.log(`\n【集計】`)
  console.log(`  対象顧客数              : ${summary.totalCustomers} 名`)
  console.log(`  新規分類 (customer_type 設定): ${summary.classifiedNewly} 名`)
  console.log(`  既分類スキップ           : ${summary.alreadyClassifiedSkipped} 名`)
  console.log(`  未分類のまま             : ${summary.stillUnclassified} 名`)

  // CustomerType 別集計
  const byType: Record<string, number> = {}
  for (const r of summary.results) {
    if (r.after.customerType) {
      byType[r.after.customerType] = (byType[r.after.customerType] ?? 0) + 1
    }
  }
  if (Object.keys(byType).length > 0) {
    console.log(`\n【CustomerType 内訳】`)
    Object.entries(byType)
      .sort(([, a], [, b]) => b - a)
      .forEach(([type, count]) => {
        console.log(`  ${type.padEnd(25)}: ${count} 名`)
      })
  }

  // 新規分類された顧客リスト（上位20名）
  const newlyClassified = summary.results
    .filter(r => r.saved && r.after.customerType !== null)
    .slice(0, 20)

  if (newlyClassified.length > 0) {
    console.log(`\n【新規分類 顧客リスト（最大20名）】`)
    console.log(`  ${'顧客名'.padEnd(15)} ${'CustomerType'.padEnd(25)} 信頼度  理由`)
    console.log(`  ${'─'.repeat(70)}`)
    for (const r of newlyClassified) {
      const name  = r.customerName.padEnd(15)
      const type  = (r.after.customerType ?? '(未分類)').padEnd(25)
      const conf  = `${(r.after.confidence * 100).toFixed(0)}%`.padStart(5)
      console.log(`  ${name} ${type} ${conf}  ${r.after.reason}`)
    }
  }

  console.log(`\n${'═'.repeat(60)}`)
  console.log(` ✅ CustomerType 再計算 完了`)
  console.log(`${'═'.repeat(60)}\n`)
}

main().catch(err => {
  console.error('❌ 実行エラー:', err)
  process.exit(1)
})
