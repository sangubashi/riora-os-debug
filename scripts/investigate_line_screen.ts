/**
 * investigate_line_screen.ts — LINE画面本物化 Pass G 事前調査(読み取り専用)
 * 本番DB書き込みなし。既存コード変更なし。
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'

const STORE_ID = '00000000-0000-0000-0000-000000000001'

async function tableSummary(supabase: ReturnType<typeof createClient>, table: string, opts: { storeCol?: string; orderCol?: string } = {}) {
  console.log(`\n--- ${table} ---`)
  let q = supabase.from(table).select('*', { count: 'exact' })
  if (opts.storeCol) q = q.eq(opts.storeCol, STORE_ID)
  const { data, count, error } = await q
  if (error) {
    console.log(`  存在しない or エラー: ${error.message}`)
    return
  }
  console.log(`  件数: ${count}`)
  if (opts.orderCol && data && data.length > 0) {
    const sorted = [...data].sort((a: any, b: any) => String(b[opts.orderCol!] ?? '').localeCompare(String(a[opts.orderCol!] ?? '')))
    console.log(`  最新1件: ${JSON.stringify(sorted[0])}`)
  } else if (data && data.length > 0) {
    console.log(`  サンプル1件: ${JSON.stringify(data[0])}`)
  }
}

async function main() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

  console.log('=== タスクで指定された対象テーブル ===')
  await tableSummary(supabase, 'line_send_queue', { orderCol: 'created_at' })
  await tableSummary(supabase, 'brain_scenarios', { storeCol: 'store_id', orderCol: 'created_at' })
  await tableSummary(supabase, 'scenario_trigger_log')
  await tableSummary(supabase, 'scenario_outcomes')
  await tableSummary(supabase, 'brain_pattern_fire_log', { storeCol: 'store_id', orderCol: 'created_at' })

  console.log('\n=== 関連テーブル(LINE画面の実装に直接関わる) ===')
  await tableSummary(supabase, 'brain_line_send_queue', { storeCol: 'store_id', orderCol: 'created_at' })
  await tableSummary(supabase, 'line_send_logs', { orderCol: 'sent_at' })
  await tableSummary(supabase, 'line_threads', { orderCol: 'last_message_at' })
  await tableSummary(supabase, 'line_messages', { orderCol: 'created_at' })
  await tableSummary(supabase, 'line_user_ids', { orderCol: 'followed_at' })
  await tableSummary(supabase, 'line_templates', { orderCol: 'created_at' })
  await tableSummary(supabase, 'line_campaigns', { orderCol: 'created_at' })
  await tableSummary(supabase, 'line_logs', { orderCol: 'sent_at' })
  await tableSummary(supabase, 'line_segments')
  await tableSummary(supabase, 'line_broadcasts', { orderCol: 'created_at' })

  console.log('\n=== 顧客との紐付け状況 ===')
  const { count: customersCount } = await supabase.from('customers').select('id', { count: 'exact', head: true })
  const { count: lineUserIdsLinked } = await supabase.from('line_user_ids').select('id', { count: 'exact', head: true }).not('customer_id', 'is', null)
  const { count: lineUserIdsTotal } = await supabase.from('line_user_ids').select('id', { count: 'exact', head: true })
  console.log(`legacy customers総数: ${customersCount}`)
  console.log(`line_user_ids総数: ${lineUserIdsTotal} (うちcustomer_id紐付け済み: ${lineUserIdsLinked})`)

  const { count: queueLinked } = await supabase.from('line_send_queue').select('id', { count: 'exact', head: true }).not('customer_id', 'is', null)
  const { count: queueTotal } = await supabase.from('line_send_queue').select('id', { count: 'exact', head: true })
  console.log(`line_send_queue総数: ${queueTotal} (うちcustomer_id紐付け済み: ${queueLinked})`)

  console.log('\n=== brain_customers側の紐付け状況 ===')
  const { count: brainCustomersCount } = await supabase.from('brain_customers').select('id', { count: 'exact', head: true }).eq('store_id', STORE_ID).is('deleted_at', null)
  console.log(`brain_customers総数: ${brainCustomersCount}`)
}

main()
