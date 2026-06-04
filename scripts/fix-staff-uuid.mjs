import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL        = 'REDACTED_URL'
const SUPABASE_SERVICE_KEY = 'REDACTED'
const STAFF_UUID          = 'ae68433d-69ce-4dc3-a38e-cc2501895fee' // test-staff@salon-riora.jp

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ── 1. SELECT で読み取り確認 ─────────────────────────────
console.log('--- 1. SELECT テスト ---')
const { data: rows, error: selErr } = await admin
  .from('customers')
  .select('id, assigned_staff_id')
  .limit(5)

if (selErr) {
  console.error('SELECT エラー:', selErr.message, selErr.code)
} else {
  console.log(`SELECT OK: ${rows?.length} 件取得`)
  rows?.forEach(r => console.log(`  id=${r.id} assigned_staff_id=${r.assigned_staff_id}`))
}

// ── 2. UPDATE 試行（条件なし全件） ─────────────────────────
console.log('\n--- 2. UPDATE テスト ---')
const { error: upErr } = await admin
  .from('customers')
  .update({ assigned_staff_id: STAFF_UUID })
  .neq('id', '00000000-0000-0000-0000-000000000000') // 全件マッチ用ダミー条件

if (upErr) {
  console.error('UPDATE エラー:', upErr.message, upErr.code)
  console.log('\n↓ Supabase Dashboard の SQL Editor で以下を直接実行してください:')
  console.log('─────────────────────────────────────────────────────────')
  console.log(`UPDATE public.customers`)
  console.log(`SET assigned_staff_id = '${STAFF_UUID}'`)
  console.log(`WHERE assigned_staff_id IS NULL`)
  console.log(`   OR assigned_staff_id != '${STAFF_UUID}';`)
  console.log('')
  console.log(`-- 確認クエリ:`)
  console.log(`SELECT COUNT(*) FROM public.customers WHERE assigned_staff_id = '${STAFF_UUID}';`)
  console.log('─────────────────────────────────────────────────────────')
} else {
  // ── 3. 更新後カウント確認 ─────────────────────────────
  const { count } = await admin
    .from('customers')
    .select('*', { count: 'exact', head: true })
    .eq('assigned_staff_id', STAFF_UUID)
  console.log(`✅ UPDATE 成功。assigned_staff_id 一致: ${count} 件`)
}
