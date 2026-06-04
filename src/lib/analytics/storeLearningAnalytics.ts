/**
 * storeLearningAnalytics.ts  — AI店舗学習 v1
 *
 * VIP分析・施術分析・商品分析を統合し、
 * 「この店舗で成果が出る共通パターン」を自動抽出する。
 * 純粋関数。Supabase 依存なし。
 */

import type { StoreLearningRule, StoreLearningResult, VipAnalyticsResult, TreatmentAnalyticsResult, ProductAnalyticsResult } from '@/types'

// ─── ダミーデータ再 export ────────────────────────────────────────────────────

export { DEMO_VIP_ROWS }       from '@/lib/analytics/vipAnalytics'
export { DEMO_TREATMENT_ROWS } from '@/lib/analytics/treatmentAnalytics'
export { DEMO_PRODUCT_ROWS }   from '@/lib/analytics/productAnalytics'

// ─── 影響度スコア算出ヘルパー ──────────────────────────────────────────────────

/** 割合(%) → 影響度スコア(0〜100) に変換 */
function rateToImpact(rate: number, base = 50): number {
  // base 以上の割合で高スコア。100% → 100, base% → 50, 0% → 0
  return Math.min(100, Math.round((rate / 100) * (50 + (rate - base) / 2 + 50)))
}

// ─── メイン統合関数 ───────────────────────────────────────────────────────────

export function calcStoreLearning(
  vip:       VipAnalyticsResult,
  treatment: TreatmentAnalyticsResult,
  product:   ProductAnalyticsResult,
): StoreLearningResult {

  const candidates: StoreLearningRule[] = []

  // ── VIP施術ルール ──────────────────────────────────────────────────────────

  vip.treatmentRanking.slice(0, 3).forEach(item => {
    if (item.rate < 30) return
    candidates.push({
      rank:     0,
      title:    `${item.name}の利用`,
      effect:   'VIP率上昇',
      impact:   rateToImpact(item.rate, 40),
      evidence: `VIPの${item.rate}%が利用`,
      category: 'treatment',
    })
  })

  // ── VIP商品ルール ──────────────────────────────────────────────────────────

  vip.productRanking.slice(0, 3).forEach(item => {
    if (item.rate < 30) return
    candidates.push({
      rank:     0,
      title:    `${item.name}の購入`,
      effect:   'リピート率上昇',
      impact:   rateToImpact(item.rate, 40),
      evidence: `VIPの${item.rate}%が購入`,
      category: 'product',
    })
  })

  // ── 施術リピート率ルール ───────────────────────────────────────────────────

  treatment.repeatRanking.slice(0, 2).forEach(item => {
    if (item.repeatRate < 60) return
    candidates.push({
      rank:     0,
      title:    `${item.name}の継続利用`,
      effect:   '来店回数増加',
      impact:   Math.round(item.repeatRate * 0.9),
      evidence: `リピート率${item.repeatRate}%`,
      category: 'treatment',
    })
  })

  // ── 商品VIP率ルール ────────────────────────────────────────────────────────

  product.vipRanking.slice(0, 2).forEach(item => {
    if (item.vipRate < 30) return
    candidates.push({
      rank:     0,
      title:    `${item.name}の初回購入`,
      effect:   'VIP化加速',
      impact:   rateToImpact(item.vipRate, 30),
      evidence: `購入者のVIP率${item.vipRate}%`,
      category: 'product',
    })
  })

  // ── 行動ルール（LINE返信率・来店周期） ──────────────────────────────────────

  if (vip.profile.avgLineResponse >= 60) {
    candidates.push({
      rank:     0,
      title:    `LINE返信率${vip.profile.avgLineResponse}%以上`,
      effect:   '来店周期短縮',
      impact:   Math.min(100, Math.round(vip.profile.avgLineResponse * 0.95)),
      evidence: `VIP平均LINE返信率${vip.profile.avgLineResponse}%`,
      category: 'behavior',
    })
  }

  if (vip.profile.avgCycleDays > 0 && vip.profile.avgCycleDays <= 35) {
    candidates.push({
      rank:     0,
      title:    `${vip.profile.avgCycleDays}日周期での来店継続`,
      effect:   'LTV最大化',
      impact:   Math.round(100 - vip.profile.avgCycleDays),
      evidence: `VIP平均来店周期${vip.profile.avgCycleDays}日`,
      category: 'cycle',
    })
  }

  // ── 店販購入率ルール ──────────────────────────────────────────────────────

  if (vip.profile.purchaseRate >= 70) {
    candidates.push({
      rank:     0,
      title:    '店販商品の購入',
      effect:   'VIP化への近道',
      impact:   Math.round(vip.profile.purchaseRate * 0.88),
      evidence: `VIP店販購入率${vip.profile.purchaseRate}%`,
      category: 'product',
    })
  }

  // ── 影響度順でソート・重複除去・ランク付け ───────────────────────────────────

  const seen  = new Set<string>()
  const rules = candidates
    .sort((a, b) => b.impact - a.impact)
    .filter(r => {
      const key = `${r.category}:${r.title}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 6)
    .map((r, i) => ({ ...r, rank: i + 1 }))

  // サマリ生成
  const top3 = rules.slice(0, 3)
  const summary = top3.length > 0
    ? `成功法則${rules.length}件を抽出。主要パターン: ${top3.map(r => r.title).join('・')}`
    : '分析データが不足しています。'

  return { rules, summary, updatedAt: new Date().toISOString() }
}
