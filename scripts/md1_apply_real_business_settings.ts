/**
 * md1_apply_real_business_settings.ts — MD-1実機検証用(本番への書込を伴う・1回のみ実行想定)
 *
 * Riora_損益分岐・コスト構造_設計書_v1.0.md §1/§2/§4記載の実数値を
 * brain_business_settings(store_id, month)へ保存する(BusinessSettingsRepo.upsert経由)。
 * 計算式は一切実行しない(保存のみ)。
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

import { getRepos } from '../app/lib/repos'

const STORE_ID = '00000000-0000-0000-0000-000000000001'
const MONTH = '2026-06-01'

async function main() {
  const repos = getRepos()

  const result = await repos.businessSettingsRepo.upsert({
    storeId: STORE_ID,
    month: MONTH,
    fixedCosts: {
      officer_suzuki: 450000,
      officer_kishi: 50000,
      outsource_kubota: 50000,
      salary_kameyama: 250000,
      salary_todate: 220000,
      commute: 42800,
      rent: 437646,
      ad_hotpepper: 55000,
      freee_monthly: 10000,
      social_insurance_estimate: 150000,
      social_insurance_actual: null,
      utilities: null,
      telecom: null,
      supplies: null,
    },
    variableCostRate: 0.075,
    variableRates: {
      incentive_rate: 0.05,
      nomination_back: 250,
      social_insurance_rate: 0.155,
      square_rate: 0.025,
      cashless_ratio: null,
      retail_cost_rate: null,
    },
  })

  console.log('=== brain_business_settings 保存結果 ===')
  console.log(JSON.stringify(result, null, 2))
}

main()
