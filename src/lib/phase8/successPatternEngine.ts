/**
 * successPatternEngine.ts  — PHASE 8
 * "この店らしい成功パターン" を customer_action_logs から学習。
 *
 * 設計:
 *   - Supabase の既存テーブルのみを使用（新テーブル最小）
 *   - deterministic 集計 → 自然言語化
 *   - AI を前に出さず、静かに成功率を上げる
 *
 * 将来: 集計結果を store_patterns テーブルにキャッシュして高速化
 */

import { supabase, DEMO_MODE } from '@/lib/supabase'
import { stableQuery, prodLog } from '@/lib/stability'
import type {
  SuccessPattern, StoreIntelligence, RetrievalSuggestion,
} from '@/types'

// ─── 成功パターン取得（Supabase集計） ────────────────────────────────────────

/**
 * staff_logs と customer_action_logs から
 * 「次回予約取得」に至ったアクションシーケンスを集計。
 */
export async function fetchSuccessPatterns(): Promise<SuccessPattern[]> {
  if (DEMO_MODE) return []   // Supabase・stableQuery を呼ばない

  // 直近90日の「next_reserved=true」ログを取得
  const since = new Date(Date.now() - 90 * 86400000).toISOString()

  const result = await stableQuery<Array<{
    customer_id: string
    menu: string | null
    ai_adopted: boolean
    next_reserved: boolean
    option_sold: boolean
    retail_sold: boolean
    created_at: string
  }>>(
    async () => {
      const { data, error } = await supabase
        .from('staff_logs')
        .select('customer_id, menu, ai_adopted, next_reserved, option_sold, retail_sold, created_at')
        .gte('created_at', since)
        .eq('next_reserved', true)
        .limit(100)
      if (error) throw error
      return (data ?? []) as Array<{
        customer_id: string; menu: string | null
        ai_adopted: boolean; next_reserved: boolean
        option_sold: boolean; retail_sold: boolean; created_at: string
      }>
    },
    [],
    { label: 'fetchSuccessPatterns', timeoutMs: 8000 }
  )

  // アクションシーケンスを集計
  const patternMap = new Map<string, { count: number; actions: string[]; menu: string }>()

  for (const row of result) {
    const actions: string[] = []
    if (row.ai_adopted)  actions.push('AI提案活用')
    if (row.option_sold) actions.push('オプション提案')
    if (row.retail_sold) actions.push('商品提案')
    actions.push('次回予約取得')

    const key = actions.join('→')
    const existing = patternMap.get(key)
    if (existing) {
      existing.count++
    } else {
      patternMap.set(key, { count: 1, actions, menu: row.menu ?? '' })
    }
  }

  const patterns: SuccessPattern[] = []
  patternMap.forEach((v, k) => {
    if (v.count < 2) return  // 2件以上のパターンのみ
    patterns.push({
      id:           k,
      customerTags: [],
      staffId:      '',
      actionType:   'next_action_rebook',   // 代表アクション
      actionContent: v.actions.join(' → '),
      outcome: {
        reVisitRate:  Math.min(v.count * 10, 95),
        lineReplyRate: 0,
        salesUp:      0,
        successScore:  Math.round(Math.min(v.count / 10, 0.95) * 100),
      },
      context: { season: undefined, concern: [], insightTags: [] },
      createdAt: new Date().toISOString(),
      // 内部利用フィールド（表示用）
      _count: v.count,
      _actionSequence: v.actions,
      _menu: v.menu,
    } as SuccessPattern & { _count: number; _actionSequence: string[]; _menu: string })
  })

  return patterns.sort((a, b) => b.outcome.successScore - a.outcome.successScore).slice(0, 5)
}

// ─── Retrieval Suggestion（類似成功導線参照） ─────────────────────────────────

export async function fetchRetrievalSuggestions(input: {
  customerType:       string
  menuName:           string
  daysSinceLastVisit: number
  churnRisk:          number
  visits:             number
}): Promise<RetrievalSuggestion[]> {
  const { customerType, menuName, churnRisk, visits } = input
  const suggestions: RetrievalSuggestion[] = []

  // パターン取得（fallback あり）
  const patterns = await stableQuery(
    () => fetchSuccessPatterns(),
    [],
    { label: 'retrievalSuggestions' }
  )

  if (patterns.length > 0) {
    const top = patterns[0]
    const seqLabel = top.actionContent
    // PHASE UX-2: 「成功スコア○%」の数値表示を削除・成功事例テキストのみ残す（confidenceの算出ロジックは維持）
    suggestions.push({
      id:          `ret-pattern-${top.id.slice(0, 8)}`,
      title:       `${seqLabel} の流れが効果的です`,
      description: `当店では「${seqLabel}」のパターンで実績があります。`,
      basedOn:     `直近90日の成功パターンから`,
      confidence:  top.outcome.successScore / 100,
    })
  }

  // ルールベース提案（customerType×churnRisk×visits）
  if (churnRisk >= 60 && visits >= 5) {
    suggestions.push({
      id:          `ret-churn-${customerType}`,
      title:       '早めのLINEフォローが離脱防止に効果的です',
      description: `${visits}回来店・${customerType}のお客様へは、来店7日以内のLINEフォローで再来率が上がる傾向があります。`,
      basedOn:     '類似顧客パターンから',
      confidence:  0.72,
    })
  }

  if (menuName.includes('エイジング') || menuName.includes('プレミアム')) {
    suggestions.push({
      id:          `ret-menu-premium`,
      title:       '施術終盤のホームケア説明が次回予約につながりやすいです',
      description: 'プレミアム系メニューでは、施術後のホームケア説明をしたケースで継続率が高くなっています。',
      basedOn:     '施術別成功パターンから',
      confidence:  0.68,
    })
  }

  return suggestions.slice(0, 3)
}

// ─── 店舗インテリジェンス ─────────────────────────────────────────────────────

export async function fetchStoreIntelligence(): Promise<StoreIntelligence> {
  // 直近30日の staff_logs から集計
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString()

  const [logsResult, menuResult] = await Promise.allSettled([
    supabase.from('staff_logs')
      .select('menu, ai_adopted, next_reserved, option_sold, retail_sold')
      .gte('created_at', since30)
      .limit(200),
    supabase.from('reservations')
      .select('menu')
      .gte('scheduled_at', since30)
      .limit(200),
  ])

  // メニュー集計
  const menuCount: Record<string, number> = {}
  if (menuResult.status === 'fulfilled' && menuResult.value.data) {
    for (const row of menuResult.value.data) {
      if (row.menu) menuCount[row.menu] = (menuCount[row.menu] ?? 0) + 1
    }
  }
  const topMenus = Object.entries(menuCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([m]) => m)

  // 提案成功率
  let aiTotal = 0, nextReservedTotal = 0, retailTotal = 0
  if (logsResult.status === 'fulfilled' && logsResult.value.data) {
    for (const row of logsResult.value.data) {
      if (row.ai_adopted)   aiTotal++
      if (row.next_reserved) nextReservedTotal++
      if (row.retail_sold)  retailTotal++
    }
  }
  const totalLogs = logsResult.status === 'fulfilled' ? (logsResult.value.data?.length ?? 0) : 0
  const repeatPct  = totalLogs > 0 ? Math.round(nextReservedTotal / totalLogs * 100) : 0
  const offerPct   = totalLogs > 0 ? Math.round(retailTotal / totalLogs * 100) : 0

  // 季節傾向（月ベース）
  const month = new Date().getMonth() + 1
  const seasonalTrends =
    month >= 3 && month <= 5  ? '春は花粉・UV対策ケアへの関心が高まる時期。美白・敏感ケアの需要増' :
    month >= 6 && month <= 8  ? '夏は毛穴・日焼けケアがピーク。施術後の紫外線ケア説明が刺さりやすい' :
    month >= 9 && month <= 11 ? '秋はエイジング・保湿ケアの仕込み時。来月に向けた集中ケア提案を' :
                                '冬は乾燥・保湿ケアの最重要季節。スキンケア商品の提案成功率が高い'

  const weeklyHint = buildWeeklyHint(repeatPct, offerPct, aiTotal, totalLogs)

  return {
    topMenus:       topMenus.length > 0 ? topMenus : ['データ集計中'],
    seasonalTrends,
    repeatPattern:  `接客後の次回予約取得率 ${repeatPct}%`,
    offerWinRate:   `商品提案成功率 ${offerPct}%`,
    weeklyHint,
  }
}

function buildWeeklyHint(repeatPct: number, offerPct: number, aiAdopted: number, total: number): string {
  if (total === 0) return '接客ログを記録すると、店舗の傾向が見えてきます'
  const aiRate = total > 0 ? Math.round(aiAdopted / total * 100) : 0

  if (repeatPct < 40) return '次回予約率を上げるには、施術終盤の自然な「次回のご提案」が効果的です'
  if (offerPct < 20)  return '商品提案のタイミングは施術後のホームケア説明と組み合わせると反応が良くなります'
  if (aiRate < 30)    return 'AI接客ポイントを活用すると、提案の精度が上がります'
  return 'バランス良く接客できています。この調子を継続しましょう'
}
