/**
 * sectionPriority.ts  — PHASE 8.5
 *
 * calculateSectionPriority:
 *   顧客状態 × 接客フェーズ × 時刻 から
 *   各 DisplaySection の優先度を決定する。
 *
 * 設計原則:
 *   - 接客テンポを崩さない（情報過多を防ぐ）
 *   - timePressure=true 時は critical/high のみ表示レベルに絞る
 *   - phase に合った情報だけを前に出す
 *   - hidden = 表示しない（ErrorBoundary の silentFail と組み合わせる）
 */

import type {
  Customer,
  PriorityLevel,
  DisplaySection,
  ActiveSession,
  ServicePhase,
  RelationshipState,
} from '@/types'
import { buildRelationshipState } from '@/lib/phase5/customerRiskEngine'

// ─── 型 ──────────────────────────────────────────────────────────────────────

export type SectionPriorityMap = Record<DisplaySection, PriorityLevel>

// ─── フェーズ別デフォルト優先度マトリクス ────────────────────────────────────
// 「接客フェーズ」ごとに、どのセクションが前に来るべきかを定義。
// 値は baseScore として後続ロジックで上下する。

type PhaseMatrix = Record<DisplaySection, number>   // 0〜100

const PHASE_BASE: Record<ServicePhase, PhaseMatrix> = {
  // カウンセリング: 顧客理解 → AI提案 → 次アクション が重要
  counseling: {
    aiInsight:     90,
    nextAction:    80,
    homeCare:      60,
    lineDraft:     40,
    voiceMemo:     30,
    timeline:      70,
    storeLearning: 50,
    serviceReplay: 10,  // まだ接客が始まっていない
    homecare:              0,
    predictiveSuggestions: 0,
    riskCard:              0,
  },
  // 施術中: 静かに。余計な情報を出さない
  treatment: {
    aiInsight:     50,
    nextAction:    30,
    homeCare:      70,  // 施術内容に連動したホームケアを準備
    lineDraft:     20,
    voiceMemo:     10,
    timeline:      20,
    storeLearning: 30,
    serviceReplay: 10,
    homecare:              0,
    predictiveSuggestions: 0,
    riskCard:              0,
  },
  // アフターケア: フォロー・提案・LINE下書き が重要
  aftercare: {
    aiInsight:     60,
    nextAction:    90,
    homeCare:      80,
    lineDraft:     85,
    voiceMemo:     70,  // 接客後の気づきを録音
    timeline:      50,
    storeLearning: 40,
    serviceReplay: 30,
    homecare:              0,
    predictiveSuggestions: 0,
    riskCard:              0,
  },
  // 会計・退店: 音声メモ・サービスリプレイ・次回提案 が最重要
  checkout: {
    aiInsight:     40,
    nextAction:    70,
    homeCare:      60,
    lineDraft:     75,
    voiceMemo:     85,
    timeline:      30,
    storeLearning: 30,
    serviceReplay: 90,  // 接客を振り返る最高のタイミング
    homecare:              0,
    predictiveSuggestions: 0,
    riskCard:              0,
  },
}

// ─── スコア → PriorityLevel 変換 ─────────────────────────────────────────────

function scoreToPriority(score: number): PriorityLevel {
  if (score >= 85) return 'critical'
  if (score >= 65) return 'high'
  if (score >= 40) return 'medium'
  if (score >= 15) return 'low'
  return 'hidden'
}

// ─── 顧客状態から来るスコア補正値 ────────────────────────────────────────────

function customerDelta(
  customer: Customer,
  section:  DisplaySection,
  relState: RelationshipState
): number {
  const {
    churn_risk,
    line_response_rate,
    visits,
    vip_rank,
    skin_tags,
    recommended_cycle_days,
  } = customer

  const daysSince = daysSinceLastVisit(customer)

  switch (section) {

    case 'aiInsight':
      // VIPや要フォロー顧客は AI インサイトを常に前に出す
      if (relState === 'at_risk' || vip_rank >= 4) return +20
      if (relState === 'cooling')                  return +10
      return 0

    case 'nextAction':
      // 離脱リスク高・来店周期超過なら最優先
      if (churn_risk >= 70)                        return +25
      if (relState === 'at_risk')                  return +20
      if (relState === 'cooling')                  return +10
      return 0

    case 'lineDraft':
      // LINE返信率が低い顧客は LINE下書きの重要度を下げる（逆効果を防ぐ）
      if (line_response_rate < 40)                 return -20
      if (relState === 'at_risk' && daysSince > 30) return +20
      if (relState === 'cooling')                  return +10
      return 0

    case 'homeCare':
      // 肌タグがあるほど価値が高い
      if ((skin_tags?.length ?? 0) >= 3)           return +15
      if ((skin_tags?.length ?? 0) >= 1)           return  +8
      return 0

    case 'voiceMemo':
      // 新規・成長中の顧客は録音価値が高い（データ蓄積が重要）
      if (visits <= 3 || relState === 'forming')   return +15
      if (relState === 'growing')                  return +10
      return 0

    case 'timeline':
      // リピーター（5回以上）は履歴の参照価値が高い
      if (visits >= 5)                             return +10
      if (visits >= 10)                            return +15
      return 0

    case 'storeLearning':
      // 離脱リスクが高いほど成功パターン参照の価値あり
      if (relState === 'at_risk')                  return +15
      if (churn_risk >= 50)                        return +10
      return 0

    case 'serviceReplay':
      // 複数回来店・VIPは振り返りの価値が高い
      if (visits >= 3 && vip_rank >= 2)            return +10
      if (visits >= 8)                             return +15
      return 0

    default:
      return 0
  }
}

// ─── 時刻補正（夜間・朝は一部セクションの優先度を下げる） ────────────────────

function timeDelta(section: DisplaySection, hour: number): number {
  // 朝イチ（8〜9時）: storeLearning を上げてその日の方針確認を促す
  if (hour >= 8 && hour <= 9 && section === 'storeLearning') return +10

  // 夕方以降（18時〜）: voiceMemo / serviceReplay を上げる（1日の振り返り）
  if (hour >= 18 && (section === 'voiceMemo' || section === 'serviceReplay')) return +10

  return 0
}

// ─── timePressure 補正 ────────────────────────────────────────────────────────

function applyTimePressure(
  scores: Record<DisplaySection, number>
): Record<DisplaySection, number> {
  const sections = Object.keys(scores) as DisplaySection[]
  const result   = { ...scores }

  for (const s of sections) {
    // timePressure 時は 65 未満のスコアを強制的に低下させて hidden に近づける
    if (result[s] < 65) result[s] = Math.max(result[s] - 25, 0)
  }

  return result
}

// ─── メイン関数 ───────────────────────────────────────────────────────────────

export function calculateSectionPriority(
  customer:      Customer,
  activeSession: ActiveSession,
  currentTime:   Date
): SectionPriorityMap {
  const { phase, timePressure } = activeSession
  const hour = currentTime.getHours()

  // 関係性ステートを顧客フィールドから推定
  const daysSince = daysSinceLastVisit(customer)
  const cycleDays = customer.recommended_cycle_days ?? 35
  const relState  = buildRelationshipState({
    customerId:           customer.id,
    visits:               customer.visits,
    totalSales:           customer.total_sales,
    lineResponseRate:     customer.line_response_rate,
    vipRank:              customer.vip_rank,
    churnRisk:            customer.churn_risk,
    daysSinceLastVisit:   daysSince,
    recommendedCycleDays: cycleDays,
    recentActionTypes:    [],
    insightTags:          customer.skin_tags ?? [],
    hasRecentPurchase:    false,
    avgPrice:             customer.avg_price,
  })

  // フェーズ基準スコアを取得して補正を加算
  const base    = PHASE_BASE[phase]
  const sections = Object.keys(base) as DisplaySection[]
  const scores: Record<DisplaySection, number> = {} as Record<DisplaySection, number>

  for (const s of sections) {
    const raw = base[s]
              + customerDelta(customer, s, relState)
              + timeDelta(s, hour)
    scores[s] = Math.max(0, Math.min(100, raw))
  }

  // timePressure 補正
  const final = timePressure ? applyTimePressure(scores) : scores

  // スコア → PriorityLevel
  const result = {} as SectionPriorityMap
  for (const s of sections) {
    result[s] = scoreToPriority(final[s])
  }

  return result
}

// ─── ヘルパー ─────────────────────────────────────────────────────────────────

function daysSinceLastVisit(customer: Customer): number {
  if (!customer.last_visit) return 0
  const ms = Date.now() - new Date(customer.last_visit).getTime()
  return Math.max(0, Math.floor(ms / 86400000))
}

// ─── useSectionPriority フック（BottomSheet で使う） ─────────────────────────

import { useMemo } from 'react'

export function useSectionPriority(
  customer:      Customer | null,
  phase?:        ServicePhase,
  timePressure?: boolean
): SectionPriorityMap | null {
  return useMemo(() => {
    if (!customer) return null
    return calculateSectionPriority(
      customer,
      { phase: phase ?? 'aftercare', timePressure: timePressure ?? false },
      new Date()
    )
  }, [customer, phase, timePressure])
}

// ─── 優先度によるレンダリング判定ヘルパー ────────────────────────────────────

/** critical / high のみ true を返す（timePressure 時の表示フィルタ用） */
export function isSectionVisible(
  priority: PriorityLevel,
  timePressure: boolean
): boolean {
  if (timePressure) return priority === 'critical' || priority === 'high'
  return priority !== 'hidden'
}

/** critical / high 順にセクション一覧をソートして返す */
export function sortedSections(
  map: SectionPriorityMap
): Array<{ section: DisplaySection; priority: PriorityLevel }> {
  const LEVEL_ORDER: Record<PriorityLevel, number> = {
    critical: 0, high: 1, medium: 2, low: 3, hidden: 4,
  }
  return (Object.entries(map) as [DisplaySection, PriorityLevel][])
    .map(([section, priority]) => ({ section, priority }))
    .sort((a, b) => LEVEL_ORDER[a.priority] - LEVEL_ORDER[b.priority])
}
