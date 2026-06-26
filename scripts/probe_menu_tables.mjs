import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) {
  console.error('Missing env: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const admin = createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const STORE_ID = '00000000-0000-0000-0000-000000000001'

const tables = ['salon_menus', 'salon_menu_options', 'salon_menu_analytics', 'salon_subscriptions', 'brain_menus']

for (const t of tables) {
  const { data, count, error } = await admin.from(t).select('*', { count: 'exact' }).limit(3)
  console.log(`\n=== ${t} ===`)
  if (error) {
    console.log('ERROR:', error.message)
  } else {
    console.log('count:', count)
    console.log(JSON.stringify(data, null, 2))
  }
}

console.log('\n=== brain_menus (store filtered) ===')
const { data: menus, count: menuCount, error: menuErr } = await admin
  .from('brain_menus')
  .select('*', { count: 'exact' })
  .eq('store_id', STORE_ID)
console.log(menuErr ? menuErr.message : `count=${menuCount}`)
console.log(JSON.stringify(menus, null, 2))

console.log('\n=== brain_visits menu_id distribution (sample) ===')
const { data: visits, error: visitErr } = await admin
  .from('brain_visits')
  .select('menu_id, treatment_amount, retail_amount, visit_date, next_booking_made, customer_id')
  .eq('store_id', STORE_ID)
  .limit(5)
console.log(visitErr ? visitErr.message : JSON.stringify(visits, null, 2))

console.log('\n=== brain_customers sample (vip-related columns) ===')
const { data: custCols, error: custErr } = await admin
  .from('brain_customers')
  .select('*')
  .limit(1)
console.log(custErr ? custErr.message : JSON.stringify(custCols, null, 2))
