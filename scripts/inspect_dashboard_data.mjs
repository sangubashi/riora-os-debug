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

const { data: settings, error: settingsErr } = await admin
  .from('brain_business_settings')
  .select('*')
  .eq('store_id', STORE_ID)
console.log('=== brain_business_settings ===')
console.log(settingsErr ? settingsErr.message : JSON.stringify(settings, null, 2))

const { count: visitCount, error: visitErr } = await admin
  .from('brain_visits')
  .select('*', { count: 'exact', head: true })
  .eq('store_id', STORE_ID)
console.log('\n=== brain_visits count (store) ===', visitErr ? visitErr.message : visitCount)

const { data: visitRange } = await admin
  .from('brain_visits')
  .select('visit_date')
  .eq('store_id', STORE_ID)
  .order('visit_date', { ascending: true })
  .limit(1)
const { data: visitRangeEnd } = await admin
  .from('brain_visits')
  .select('visit_date')
  .eq('store_id', STORE_ID)
  .order('visit_date', { ascending: false })
  .limit(1)
console.log('=== visit_date range ===', visitRange?.[0]?.visit_date, '~', visitRangeEnd?.[0]?.visit_date)

const { count: dashboardCount, error: dashErr } = await admin
  .from('brain_dashboard_daily')
  .select('*', { count: 'exact', head: true })
  .eq('store_id', STORE_ID)
console.log('\n=== brain_dashboard_daily count (store) ===', dashErr ? dashErr.message : dashboardCount)

const { count: customerCount } = await admin
  .from('brain_customers')
  .select('*', { count: 'exact', head: true })
  .eq('store_id', STORE_ID)
console.log('=== brain_customers count (store) ===', customerCount)

const { data: sampleVisit } = await admin
  .from('brain_visits')
  .select('*')
  .eq('store_id', STORE_ID)
  .limit(1)
console.log('\n=== sample brain_visits row ===')
console.log(JSON.stringify(sampleVisit, null, 2))
