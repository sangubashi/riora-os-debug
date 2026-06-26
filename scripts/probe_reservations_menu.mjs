import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const admin = createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const { data, count, error } = await admin
  .from('reservations')
  .select('menu, price, duration_minutes, status, scheduled_at', { count: 'exact' })
  .order('scheduled_at', { ascending: false })
  .limit(500)

console.log('count (capped 500 fetched):', count, 'error:', error?.message)
if (data) {
  const byMenu = {}
  for (const r of data) {
    const k = r.menu ?? '(null)'
    byMenu[k] = byMenu[k] || { count: 0, prices: [], durations: [] }
    byMenu[k].count++
    byMenu[k].prices.push(r.price)
    byMenu[k].durations.push(r.duration_minutes)
  }
  console.log(JSON.stringify(byMenu, null, 2))
}
