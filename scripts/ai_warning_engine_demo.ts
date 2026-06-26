/**
 * ai_warning_engine_demo.ts — AIWarningEngineのロジック動作確認(本番DBへは一切接続しない)
 *
 * 本番brain_customers/brain_visitsには現状「複数来店した顧客」が0件
 * (来店周期・LTV・客単価ベースの判定には2回以上の来店履歴が必要)のため、
 * 実機(本番データ)では`computeAIWarnings()`が正しく空配列を返す(モックで埋めない設計の
 * 意図した挙動)。本スクリプトは、ロジック自体が実データ形式で正しく動くことを示すための
 * ローカル限定の動作確認であり、結果を本番DBへ書き込むことは一切しない。
 */
import { computeAIWarnings } from '../src/lib/dashboard/AIWarningEngine'
import type { Customer, Visit, Staff, Subscription } from '../src/types/riora.types'

function customer(id: string, name: string, assignedStaffId: string | null = null): Customer {
  return {
    id, storeId: 'demo', name, ageGroup: null, customerType: null, typeConfidence: 0,
    goalNote: null, weddingDate: null, acquisitionChannel: null, firstVisitDate: null,
    assignedStaffId, isSubscriber: false, subscribedAt: null, churnScore: 0, churnReason: null,
    consentAnonymizedLearning: false, prefecture: null, city: null, externalKeyHash: null,
  }
}

function visit(customerId: string, visitDate: string, treatmentAmount: number): Visit {
  return {
    id: `v-${customerId}-${visitDate}`, storeId: 'demo', customerId, staffId: 'staff-1', menuId: 'menu-1',
    visitDate, visitCountAt: 1, isNomination: false, treatmentAmount, retailAmount: 0, retailCategory: null,
    homecarePurchased: false, homecareDeclined: false, nextBookingMade: false, noBookingReason: null,
    voiceMemoUrl: null, visitScore: 0,
  }
}

const customers: Customer[] = [
  customer('c1', '田中花子', 'staff-1'),   // 高頻度・高単価のVIP想定。来店が長期間止まっている
  customer('c2', '佐藤美咲'),              // 通常客。来店周期がやや超過(早期段階)
  customer('c3', '鈴木理恵'),
  customer('c4', '高橋優子'),
  customer('c5', '伊藤さくら'),
]

const visits: Visit[] = [
  visit('c1', '2026-01-05', 60000),
  visit('c1', '2026-02-10', 60000), // 平均間隔36日・最終来店から約4.5ヶ月(後述asOfDate基準)
  visit('c2', '2026-05-01', 8000),
  visit('c2', '2026-05-31', 8000),  // 平均間隔30日・基準日時点で約34日経過(早期超過)
  visit('c3', '2026-06-01', 8000),
  visit('c4', '2026-06-01', 8000),
  visit('c5', '2026-06-01', 8000),
]

const staff: Staff[] = [{ id: 'staff-1', storeId: 'demo', name: '外舘', style: 'evidence', isActive: true, nameAliases: [] }]

const subscriptions: Subscription[] = [
  { id: 'sub-1', storeId: 'demo', customerId: 'c3', planName: 'プレミアムサブスク', monthlyPrice: 20000, startedAt: '2026-01-28', cancelledAt: null, cancelReason: null },
]

const insights = computeAIWarnings({
  asOfDate: '2026-06-25',
  customers, visits, staff, subscriptions,
  monthlyVisitCount: 5,
  currentRepeat30: 0.3, previousRepeat30: 0.6,
  currentNominationRate: 0.2, previousNominationRate: 0.5,
})

console.log(`=== AIWarningEngine 動作確認(ローカルのみ・本番DB非接触・${insights.length}件生成) ===\n`)
for (const insight of insights) {
  console.log(`[${insight.severity}] ${insight.title} (対象${insight.targetCount}件・${insight.actionType})`)
  console.log(`  ${insight.message}\n`)
}
