/**
 * kpiHintEngine.ts  — PHASE 8
 * KPI 数値を「改善ヒント」として自然言語表示。
 * "数字" ではなく "次の行動" を示す。
 *
 * 既存 AiInsight 型と互換。useKpiStore の insights に差し込む。
 */

import type { KpiHint } from '@/types'
import type { KpiSnapshot } from '@/store/useKpiStore'
import type { AiInsight } from '@/store/useKpiStore'

// ─── KPI → ヒント変換ルール ──────────────────────────────────────────────────

interface HintRule {
  condition: (curr: KpiSnapshot, prev: KpiSnapshot) => boolean
  hint:      (curr: KpiSnapshot, prev: KpiSnapshot) => KpiHint
}

const HINT_RULES: HintRule[] = [

  // 次回予約率低下
  {
    condition: (c, p) => c.nextReserveRate < p.nextReserveRate - 5,
    hint: (c) => ({
      kpiKey:    'nextReserveRate',
      direction: 'down',
      hint:      `次回予約率が${c.nextReserveRate}%に下がっています。施術終盤での「次回はどうされますか？」の自然な一言が予約取得率を上げます。`,
      urgency:   'medium',
    }),
  },

  // LINE返信率低下
  {
    condition: (c, p) => c.lineResponseRate < 60 && c.lineResponseRate < p.lineResponseRate,
    hint: (c) => ({
      kpiKey:    'lineResponseRate',
      direction: 'down',
      hint:      `LINE返信率${c.lineResponseRate}%。メッセージを「短め・絵文字1つ・季節感あり」にすると返信率が上がる傾向があります。`,
      urgency:   'medium',
    }),
  },

  // VIP比率上昇中
  {
    condition: (c, p) => c.vipRate > p.vipRate + 2,
    hint: (c) => ({
      kpiKey:    'vipRate',
      direction: 'up',
      hint:      `VIP比率${c.vipRate}%で上昇中。この層への特別感ある提案を強化するとさらに安定します。`,
      urgency:   'low',
    }),
  },

  // リピート率高め
  {
    condition: (c, _) => c.repeatRate >= 80,
    hint: (c) => ({
      kpiKey:    'repeatRate',
      direction: 'up',
      hint:      `リピート率${c.repeatRate}%は好水準。安定基盤があるので新規→VIP転換の強化が次の成長ポイントです。`,
      urgency:   'low',
    }),
  },

  // 稼働率低め
  {
    condition: (c, _) => c.occupancyRate < 60,
    hint: (c) => ({
      kpiKey:    'occupancyRate',
      direction: 'down',
      hint:      `稼働率${c.occupancyRate}%。既存顧客への来店サイクル通知LINEで埋まりやすくなります。`,
      urgency:   'medium',
    }),
  },

  // 全体良好
  {
    condition: (c, _) => c.repeatRate >= 70 && c.lineResponseRate >= 75 && c.occupancyRate >= 75,
    hint: () => ({
      kpiKey:    'overall',
      direction: 'up',
      hint:      '主要KPIが安定しています。この接客リズムを維持しながら、新しいお客様のVIP化に集中しましょう。',
      urgency:   'low',
    }),
  },
]

// ─── KPI → AiInsight 変換 ────────────────────────────────────────────────────

export function generateKpiHints(
  current:  KpiSnapshot,
  previous: KpiSnapshot
): AiInsight[] {
  const hints: KpiHint[] = []

  for (const rule of HINT_RULES) {
    if (rule.condition(current, previous)) {
      hints.push(rule.hint(current, previous))
      if (hints.length >= 3) break  // 最大3件
    }
  }

  if (hints.length === 0) {
    hints.push({
      kpiKey:    'overall',
      direction: 'stable',
      hint:      '接客データが蓄積されています。記録を続けると、店舗の傾向がより明確に見えてきます。',
      urgency:   'low',
    })
  }

  // AiInsight 型に変換（既存 KpiDashboard と互換）
  return hints.map((h, i) => ({
    id:      `hint-${h.kpiKey}-${i}`,
    type:    h.urgency === 'high' ? 'warning' as const :
             h.direction === 'up' ? 'praise'  as const : 'tip' as const,
    message: h.hint,
    action:  h.urgency !== 'low' ? '詳細を確認' : undefined,
  }))
}

// ─── Semantic Memory 強化（InsightTag → 意味理解） ─────────────────────────────

/**
 * InsightTag の組み合わせから「意味レベルのサマリー」を生成。
 * タグの羅列ではなく、顧客の状況を一文で表現。
 */
export function semanticInsightSummary(insightTags: string[], skinTags: string[]): string {
  const all = [...insightTags, ...skinTags]

  if (all.includes('event_before') && all.includes('high_motivation')) {
    return 'イベントを控えて肌への意識が高まっている状態。提案を積極的に受け入れやすいタイミングです'
  }
  if (all.includes('busy_lifestyle') && all.includes('low_homecare')) {
    return '日々が忙しくホームケアが後回しになっている状態。「1分でできるケア」など手軽さを重視した提案が刺さります'
  }
  if (all.includes('price_sensitive') && all.includes('high_motivation')) {
    return '来店意欲はあるが費用感を気にしている状態。効果の見える化や継続メリットを丁寧に説明すると安心感が生まれます'
  }
  if ((all.includes('dry') || all.includes('dryness_concern')) && all.includes('aging_concern')) {
    return '乾燥とエイジングのダブル悩みがある状態。保湿×エイジングケアを組み合わせた提案が最も響きます'
  }
  if (all.includes('sensitive_skin') || all.includes('sensitive')) {
    return '肌が敏感な状態。刺激を与えない安心感のある提案が信頼につながります'
  }
  if (insightTags.includes('high_motivation')) {
    return '来店モチベーションが高く、施術への期待感が高まっている状態です'
  }
  if (all.includes('at_risk') || insightTags.includes('dryness_concern')) {
    return '肌の変化が気になり始めている状態。具体的なケア方法を伝えると喜ばれます'
  }

  return ''  // 特定の意味が読み取れない場合は空（表示しない）
}
