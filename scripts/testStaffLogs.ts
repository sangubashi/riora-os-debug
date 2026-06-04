import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const url     = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const sb      = createClient(url, anonKey)

async function run(label: string, payload: Record<string, unknown>) {
  console.log(`\n── INSERT: ${label} ──`)
  console.log('payload:', JSON.stringify(payload))

  const { data, error } = await sb
    .from('staff_logs')
    .insert(payload)
    .select('*')
    .single()

  if (error) {
    console.error(`❌ FAILED  code=${error.code}  ${error.message}`)
    return null
  }
  console.log('✅ INSERT OK  id:', data.id)
  return data
}

async function main() {
  const results: { label: string; ok: boolean; detail: string }[] = []

  // ── テスト A: 既存カラムのみ ─────────────────────────────────
  const rowA = await run('既存カラムのみ', {
    reservation_id: null,
    customer_id:    null,
    staff_id:       null,
    ai_adopted:     true,
    next_reserved:  true,
    option_sold:    false,
    retail_sold:    false,
    churn_followed: false,
  })
  results.push({ label: 'INSERT (既存カラム)', ok: !!rowA, detail: rowA ? `id=${rowA.id}` : 'failed' })

  // ── テスト B: SELECT 確認 ────────────────────────────────────
  if (rowA) {
    const { data: fetched, error: selErr } = await sb
      .from('staff_logs')
      .select('*')
      .eq('id', rowA.id)
      .single()

    const selOk = !selErr && !!fetched
    results.push({ label: 'SELECT 確認', ok: selOk, detail: selOk ? `ai_adopted=${fetched!.ai_adopted}` : selErr!.message })

    if (selOk) {
      console.log('\n── SELECT 結果 ──')
      console.log(JSON.stringify(fetched, null, 2))
    }

    // cleanup
    await sb.from('staff_logs').delete().eq('id', rowA.id)
    console.log('\n✅ テストデータ削除済み')
  }

  // ── テスト C: service_completed あり（カラムが存在するか確認）──
  const rowC = await run('service_completed カラムあり', {
    ai_adopted:        true,
    service_completed: false,
  })
  const scOk = !!rowC
  results.push({ label: 'service_completed カラム', ok: scOk, detail: scOk ? '✅ 存在する' : '❌ 未作成' })
  if (rowC) await sb.from('staff_logs').delete().eq('id', rowC.id)

  // ── 結果サマリー ─────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════')
  console.log('                テスト結果')
  console.log('══════════════════════════════════════════')
  results.forEach(r => {
    console.log(`  ${r.ok ? '✅' : '❌'}  ${r.label.padEnd(28)} ${r.detail}`)
  })
  console.log('══════════════════════════════════════════')

  if (!scOk) {
    console.log('\n【要対応】Supabase SQL Editor で以下を実行してください:')
    console.log('─────────────────────────────────────────')
    console.log('ALTER TABLE staff_logs')
    console.log('  ADD COLUMN IF NOT EXISTS service_completed boolean NOT NULL DEFAULT false;')
    console.log('─────────────────────────────────────────')
  } else {
    console.log('\n✅ 全カラム確認完了。フロントから呼び出し可能です。')
  }
}

main().catch(console.error)
