import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const admin = createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const STORE_ID = '00000000-0000-0000-0000-000000000001'

const { count: custCount } = await admin.from('brain_customers').select('*', { count: 'exact', head: true }).eq('store_id', STORE_ID)
const { count: visitCount } = await admin.from('brain_visits').select('*', { count: 'exact', head: true }).eq('store_id', STORE_ID)
console.log('brain_customers count:', custCount)
console.log('brain_visits count:', visitCount)

const { data: customers } = await admin.from('brain_customers').select('id,name,first_visit_date').eq('store_id', STORE_ID)
console.log('\n=== customers (name, count duplicates) ===')
const byName = new Map()
customers.forEach(c => {
  const arr = byName.get(c.name) ?? []
  arr.push(c.id)
  byName.set(c.name, arr)
})
byName.forEach((ids, name) => {
  if (ids.length > 1) console.log('DUPLICATE NAME:', name, ids.length, 'rows')
})
console.log('distinct names:', byName.size, 'total customer rows:', customers.length)

const { data: visits } = await admin.from('brain_visits').select('id,customer_id,visit_date,treatment_amount,retail_amount').eq('store_id', STORE_ID)
console.log('\n=== visits sample (first 5) ===')
console.log(JSON.stringify(visits.slice(0,5), null, 2))
console.log('total visit rows:', visits.length)
const sumTreatment = visits.reduce((s,v)=>s+v.treatment_amount,0)
const sumRetail = visits.reduce((s,v)=>s+v.retail_amount,0)
console.log('sum treatment_amount:', sumTreatment, 'sum retail_amount:', sumRetail, 'total:', sumTreatment+sumRetail)
