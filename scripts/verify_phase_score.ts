/**
 * verify_phase_score.ts
 *
 * customers テーブルの実データを取得し、
 * calcCustomerPhase / calcCustomerScore を実行して結果を console.log する最小テスト。
 *
 * 実行方法:
 *   npx tsx scripts/verify_phase_score.ts
 *
 * 前提:
 *   - .env.local に NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY があること
 *   - DEMO_MODE=false であること（src/lib/supabase.ts を確認）
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { calcCustomerPhase, calcCustomerScore } from '../src/lib/phase5/customerRiskEngine'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

async function main() {
  // 1. customers テーブルから実データ取得
  const { data, error } = await supabase
    .from('customers')
    .select(`
      id,
      name,
      visit_count,
      total_sales,
      churn_risk_score,
      vip_rank,
      recommended_cycle_days,
      line_response_rate,
      avg_price
    `)
    .order('visit_count', { ascending: false })
    .limit(10)

  if (error) {
    console.error('[ERROR] customers 取得失敗:', error.message)
    process.exit(1)
  }

  if (!data || data.length === 0) {
    console.warn('[WARN] customers テーブルが空 or RLS でデータなし')
    process.exit(0)
  }

  console.log(`\n取得件数: ${data.length}件\n`)
  console.log('='.repeat(70))

  for (const c of data) {
    const visits              = Number(c.visit_count)        ?? 0
    const totalSales          = Number(c.total_sales)        ?? 0
    const churnRisk           = Number(c.churn_risk_score)   ?? 0
    const vipRank             = Number(c.vip_rank)           ?? 0
    const recommendedCycleDays = Number(c.recommended_cycle_days) ?? 30
    const lineResponseRate    = Number(c.line_response_rate) ?? 50
    const avgPrice            = Number(c.avg_price)          ?? 0

    // days_since_last_visit は customers テーブルに列がない場合、
    // get_customer_stats RPC または reservations から算出する想定。
    // ここでは churn_risk_score から推定（暫定値 0）
    const daysSinceLastVisit  = 0  // ← 実データに列があれば差し替え

    // calcCustomerPhase
    const phase = calcCustomerPhase({
      visits,
      totalSales,
      vipRank,
      churnRisk,
      daysSinceLastVisit,
      recommendedCycleDays,
    })

    // calcCustomerScore
    const scoreResult = calcCustomerScore({
      visits,
      totalSales,
      avgPrice,
      lineResponseRate,
      vipRank,
      churnRisk,
    })

    console.log(`顧客: ${c.name ?? c.id}`)
    console.log(`  visits=${visits}  totalSales=${totalSales.toLocaleString()}  churnRisk=${churnRisk}  vipRank=${vipRank}  daysSince=${daysSinceLastVisit}`)
    console.log(`  → phase: ${phase}`)
    console.log(`  → score: ${scoreResult.total}点 (scorePhase: ${scoreResult.phase})`)
    console.log(`     内訳: 来店${scoreResult.breakdown.visits.score} 売上${scoreResult.breakdown.sales.score} 店販${scoreResult.breakdown.retailSales.score} LINE${scoreResult.breakdown.lineResponse.score} 紹介${scoreResult.breakdown.referral.score} 継続${scoreResult.breakdown.retention.score}`)
    console.log('-'.repeat(70))
  }
}

main()
