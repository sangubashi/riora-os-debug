/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const url     = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const svcKey  = process.env.SUPABASE_SERVICE_ROLE_KEY

console.log('── 環境変数チェック ──')
if (!url || !anonKey) { console.error('❌ NEXT_PUBLIC_ 変数が未設定'); process.exit(1) }
console.log('✓ NEXT_PUBLIC_SUPABASE_URL      :', url)
console.log('✓ NEXT_PUBLIC_SUPABASE_ANON_KEY :', anonKey.slice(0, 24) + '...')

const anon: any  = createClient(url, anonKey)
const admin: any = svcKey ? createClient(url, svcKey, { auth: { persistSession: false } }) : null

async function chk(client: any, table: string, label: string) {
  const { data, error } = await client.from(table).select('*').limit(1)
  if (error) {
    if (error.code === 'PGRST205') return `❌ ${label}[${table}]: テーブル未存在 or 未公開`
    if (error.code === '42501')    return `⚠️  ${label}[${table}]: RLS拒否 (テーブルは存在)`
    return `❌ ${label}[${table}]: ${error.code} - ${error.message}`
  }
  return `✓  ${label}[${table}]: OK (${data?.length ?? 0}件)`
}

async function main() {
  console.log('\n── anon key 疎通 ──')
  console.log(await chk(anon, 'staff_logs',    'anon'))
  console.log(await chk(anon, 'reservations',  'anon'))
  console.log(await chk(anon, 'line_campaigns','anon'))

  if (admin) {
    console.log('\n── service key 疎通 ──')
    console.log(await chk(admin, 'staff_logs',    'svc'))
    console.log(await chk(admin, 'reservations',  'svc'))
    console.log(await chk(admin, 'customers',     'svc'))

    const { data: tbls } = await admin
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public')
      .order('table_name')
    console.log('\n── public テーブル一覧 ──')
    tbls?.forEach((t: any) => console.log('  -', t.table_name))
  }

  console.log('\n── staff_logs INSERT (anon key) ──')
  const { data: ins, error: insErr } = await anon
    .from('staff_logs')
    .insert({ ai_adopted: true })
    .select('id, ai_adopted, created_at')
    .single()

  if (insErr) {
    console.error('❌ INSERT(anon):', insErr.code, insErr.message)
    if (insErr.code === '42501')
      console.log('   → Auth ログイン後でないと anon INSERT は RLS に弾かれます')
  } else {
    console.log('✓  INSERT(anon) OK:', ins)
    await anon.from('staff_logs').delete().eq('id', ins.id)
    console.log('   cleanup done')
  }

  console.log('\n✅ 接続テスト完了')
}

main().catch(console.error)
