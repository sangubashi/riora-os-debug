import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'
import { runDashboardAggregator } from '../src/lib/dashboard/DashboardAggregator'
import { VisitRepo } from '../src/repositories/supabase/VisitRepo'
import { BusinessSettingsRepo } from '../src/repositories/supabase/BusinessSettingsRepo'
import { DashboardRepo } from '../src/repositories/supabase/DashboardRepo'
import { CustomerRepo } from '../src/repositories/supabase/CustomerRepo'
import { StaffRepo } from '../src/repositories/supabase/StaffRepo'
import { SubscriptionRepo } from '../src/repositories/supabase/SubscriptionRepo'

const STORE_ID = '00000000-0000-0000-0000-000000000001'
const snapshotDate = process.argv[2] ?? new Date().toISOString().slice(0, 10)

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  const result = await runDashboardAggregator(
    { storeId: STORE_ID, snapshotDate },
    {
      visitRepo: new VisitRepo(supabase),
      businessSettingsRepo: new BusinessSettingsRepo(supabase),
      dashboardRepo: new DashboardRepo(supabase),
      customerRepo: new CustomerRepo(supabase),
      staffRepo: new StaffRepo(supabase),
      subscriptionRepo: new SubscriptionRepo(supabase),
    }
  )

  console.log('=== DashboardAggregator result (brain_dashboard_dailyへUPSERT済み) ===')
  console.log(JSON.stringify(result, null, 2))
}

main()
