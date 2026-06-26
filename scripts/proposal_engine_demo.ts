/**
 * proposal_engine_demo.ts — AI提案エンジンのロジック動作確認(本番DBへは一切書き込まない)
 *
 * 本番brain_customersは全40件がcustomer_type未設定(調査済み・完成レポート参照)のため、
 * 現状の実顧客データではPatternContextBuilderが必ずno_customer_typeで停止する
 * (架空のtypeを割り当てて動かすことは禁止のため、これは正しい挙動)。
 *
 * 本スクリプトは、本番の実マスタデータ(brain_success_patterns/brain_pattern_steps/
 * brain_params)を読み取り専用で取得し、エンジン自体が正しく動作することを
 * ローカルで確認する(顧客コンテキストのみ、type分類が未整備な現状を踏まえた
 * 説明用のサンプル値とし、本番へは何も書き込まない)。
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'
import { CandidateRepo } from '../src/repositories/supabase/CandidateRepo'
import { ParamsRepo } from '../src/repositories/supabase/ParamsRepo'
import { JsonLogicEvaluator } from '../src/engines/pattern/JsonLogicEvaluator'
import { PatternMatcher } from '../src/engines/pattern/PatternMatcher'
import { PatternScorer } from '../src/engines/pattern/PatternScorer'
import { ConflictResolver } from '../src/engines/pattern/ConflictResolver'
import { StaffAdjustmentEngine } from '../src/engines/pattern/StaffAdjustmentEngine'
import { ProposalOrchestrator } from '../src/engines/pattern/ProposalOrchestrator'
import type { Overrides, PatternContext, Staff } from '../src/types/riora.types'

const STORE_ID = '00000000-0000-0000-0000-000000000001'

async function main() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

  // 実マスタデータ(読み取り専用)
  const candidates = await new CandidateRepo(supabase).loadActive(STORE_ID)
  const paramsRepo = new ParamsRepo(supabase)
  const weights = await paramsRepo.weights('office_area')
  const styleAffinity = await paramsRepo.styleAffinity('office_area')
  console.log(`実候補数(brain_success_patterns/brain_pattern_steps): ${candidates.length}件`)

  // 本番に customer_type 設定済み顧客が0件のため、説明用のサンプルcontext
  // (本番には一切書き込まない・ローカル変数のみ)。
  const ctx: PatternContext = {
    visitCount: 4, daysSinceLast: 25, avgCycle: 25, isNominationStreak2: true,
    homecarePurchasedEver: true, homecareDeclinedRecent: false, skinImproved: true,
    skinStagnant2: false, subscConditionsMet: 4, churnScore: 0.1, nextBookingMadeLast: true,
    weddingDaysLeft: null, retailTotal: 5000,
    raw: { typeConfidence: 0.85, csi: 0.6, skinDeltaTrend: 1.5, cycleRatio: 1.0, lastVisitDate: '2026-06-01' },
    customerType: 'A_acne', customerId: 'demo-customer', storeId: STORE_ID,
  }
  const staff: Staff = { id: '00000000-0000-0000-0000-000000000101', storeId: STORE_ID, name: '鈴木', style: 'evidence', isActive: true, nameAliases: [] }
  const overrides: Overrides = { manualPin: null, storeOverrideCodes: new Set() }

  const evaluator = new JsonLogicEvaluator()
  const orchestrator = new ProposalOrchestrator({
    statsRepo: { loadCells: async () => new Map() }, // 実績統計0件(brain_pattern_step_stats実データ・冷スタート)
    matcher: new PatternMatcher(evaluator),
    scorer: new PatternScorer(),
    resolver: new ConflictResolver(evaluator),
    staffAdjust: new StaffAdjustmentEngine(),
  })

  const result = await orchestrator.generateFinalProposalSet({
    ctx, candidates, staff, adjustments: [], weights, styleAffinity, overrides,
    recentOutcomes: [], consentDm: false, nowJst: '2026-06-25',
  })

  console.log('\n=== 提案結果(ローカル・本番DB非接触) ===')
  console.log(JSON.stringify(result, null, 2))
}

main()
