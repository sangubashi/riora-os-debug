/**
 * staffStyleEngine.ts  — PHASE 8
 * スタッフごとの「接客スタイル」を自然言語で理解・表示。
 * "評価" ではなく "強み・傾向の発見" として扱う。
 *
 * データソース: staff_logs + customer_action_logs（既存テーブルのみ）
 */

import { supabase } from '@/lib/supabase'
import { stableQuery } from '@/lib/stability'
import type { StaffStyleProfile } from '@/types'

// ─── スタッフスタイル取得 ─────────────────────────────────────────────────────

export async function fetchStaffStyleProfile(staffId: string): Promise<StaffStyleProfile | null> {
  const since60 = new Date(Date.now() - 60 * 86400000).toISOString()

  const [logsResult, actionResult] = await Promise.allSettled([
    stableQuery<Array<{
      ai_adopted: boolean; next_reserved: boolean; option_sold: boolean
      retail_sold: boolean; churn_followed: boolean
    }>>(
      async () => {
        const { data, error } = await supabase
          .from('staff_logs')
          .select('ai_adopted, next_reserved, option_sold, retail_sold, churn_followed')
          .eq('staff_id', staffId)
          .gte('created_at', since60)
          .limit(50)
        if (error) throw error
        return data ?? []
      },
      [],
      { label: 'staffStyleLogs' }
    ),

    stableQuery<Array<{ action_type: string }>>(
      async () => {
        const { data, error } = await supabase
          .from('customer_action_logs')
          .select('action_type')
          .eq('staff_id', staffId)
          .gte('created_at', since60)
          .limit(100)
        if (error) throw error
        return data ?? []
      },
      [],
      { label: 'staffActionLogs' }
    ),
  ])

  const logs    = logsResult.status    === 'fulfilled' ? logsResult.value    : []
  const actions = actionResult.status  === 'fulfilled' ? actionResult.value  : []

  if (logs.length === 0 && actions.length === 0) return null

  // 集計
  const total         = logs.length
  const aiAdoptedPct  = total > 0 ? logs.filter(l => l.ai_adopted).length  / total : 0
  const nextResPct    = total > 0 ? logs.filter(l => l.next_reserved).length / total : 0
  const retailPct     = total > 0 ? logs.filter(l => l.retail_sold).length  / total : 0
  const churnPct      = total > 0 ? logs.filter(l => l.churn_followed).length / total : 0

  const lineActions   = actions.filter(a => a.action_type.includes('line')).length
  const homecareActions = actions.filter(a => a.action_type.includes('homecare')).length

  // 自然言語化
  const offerTiming = nextResPct >= 0.6
    ? '次回提案のタイミングが自然で、高い確率で予約につながっています'
    : nextResPct >= 0.35
    ? '次回提案は入れられているので、タイミングをさらに磨くと向上します'
    : '施術終盤での次回予約提案を意識すると、リピート率が上がります'

  const lineStyle = lineActions >= 5
    ? 'LINEフォローを積極的に活用していて、顧客との接点が多い'
    : lineActions >= 2
    ? 'LINEフォローを行っている。さらに活用すると効果が出やすいです'
    : 'LINE送信の活用でフォロー体制を強化できます'

  const repeatStrength = nextResPct >= 0.5
    ? '継続来店への誘導が得意で、安定したリピート基盤を持っています'
    : retailPct >= 0.3
    ? '商品提案と連動したリピート誘導で強みを発揮しています'
    : 'ホームケア説明を丁寧にすることでリピート率向上が期待できます'

  const topCustomerType = aiAdoptedPct >= 0.5
    ? 'AIアドバイスを活用した効果重視型へのアプローチが得意'
    : churnPct >= 0.3
    ? '離脱しかけた顧客の関係修復が得意な傾向があります'
    : homecareActions >= 3
    ? 'ホームケアに熱心なお客様との信頼構築が得意です'
    : '幅広い顧客タイプに対応できるバランス型スタイル'

  const insight = buildInsight(nextResPct, aiAdoptedPct, retailPct, lineActions, total)

  return { staffId, offerTiming, lineStyle, repeatStrength, topCustomerType, insight }
}

function buildInsight(
  nextResPct: number, aiPct: number, retailPct: number, lineCount: number, total: number
): string {
  if (total < 3) return 'データが蓄積中です。接客後にログを記録すると傾向が見えてきます'

  const strengths: string[] = []
  if (nextResPct >= 0.6) strengths.push('次回予約取得')
  if (aiPct >= 0.5)      strengths.push('AI活用')
  if (retailPct >= 0.3)  strengths.push('商品提案')
  if (lineCount >= 5)    strengths.push('LINEフォロー')

  if (strengths.length >= 2) {
    return `「${strengths.slice(0, 2).join('×')}」が得意な接客スタイルです`
  }
  if (strengths.length === 1) {
    return `「${strengths[0]}」に強みがあります。他の要素も組み合わせるとさらに効果的です`
  }
  return '各アクションをバランスよく実践できています。記録を続けると強みが明確になります'
}
