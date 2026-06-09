import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })

const URL  = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) {
  console.error('Missing env: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const admin = createClient(URL, KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// information_schema でカラム一覧を取得
const { data, error } = await admin
  .from('information_schema.columns')
  .select('column_name, data_type, ordinal_position')
  .eq('table_schema', 'public')
  .eq('table_name', 'reservations')
  .order('ordinal_position')

if (error) {
  console.error('information_schema クエリ失敗:', error.message)

  // フォールバック: REST で1行取得してキーを見る
  const r2 = await fetch(
    `${URL}/rest/v1/reservations?limit=1`,
    { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } }
  )
  const rows = await r2.json()
  if (Array.isArray(rows) && rows.length > 0) {
    console.log('\nreservations の実カラム一覧（REST経由）:')
    Object.entries(rows[0]).forEach(([k, v]) =>
      console.log(`  ${k.padEnd(28)} = ${JSON.stringify(v)}`)
    )
  } else {
    console.log('REST応答:', JSON.stringify(rows).slice(0, 300))
  }
  process.exit(0)
}

console.log('\nreservations カラム一覧:')
console.log('  ' + 'COLUMN_NAME'.padEnd(30) + 'DATA_TYPE')
console.log('  ' + '-'.repeat(50))
data.forEach(r =>
  console.log(`  ${r.column_name.padEnd(30)}${r.data_type}`)
)
