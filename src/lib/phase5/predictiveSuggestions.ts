/**
 * predictiveSuggestions.ts  — PHASE 5
 * 「今後必要になりそう」な提案を先回り表示。
 * NextAction（今すぐやるべき）との差別化:
 *   - NextAction = 今日・今週の行動
 *   - PredictiveSuggestion = 来週〜来月の先回り
 */

import type { PredictiveSuggestion, SkinTagKey } from '@/types'

export interface PredictiveInput {
  customerId:          string
  visits:              number
  daysSinceLastVisit:  number
  recommendedCycleDays: number
  insightTags:         string[]
  skinTags:            SkinTagKey[]
  lineResponseRate:    number
  hasRecentPurchase:   boolean
  vipRank:             number
  recentActionTypes:   string[]
}

export function buildPredictiveSuggestions(
  input: PredictiveInput,
  maxCount = 2
): PredictiveSuggestion[] {
  const {
    visits, daysSinceLastVisit, recommendedCycleDays,
    insightTags, skinTags, lineResponseRate,
    hasRecentPurchase, vipRank, recentActionTypes,
  } = input

  const results: PredictiveSuggestion[] = []
  const remaining = recommendedCycleDays - daysSinceLastVisit

  // ── soon（1週間以内に必要） ──────────────────────────────────────────────

  // イベント前の集中ケア準備
  if (insightTags.includes('event_before') && !hasRecentPurchase) {
    results.push({
      id:       'pred_event_care',
      horizon:  'soon',
      title:    'イベント前の集中ケアを準備',
      description: 'イベント前に特別ケアセットをご提案すると購入率が高まります。',
      triggerReason: '音声メモからイベント前需要を検出',
    })
  }

  // 来店サイクル近づき → 再来予約の準備
  if (remaining >= 5 && remaining <= 14) {
    results.push({
      id:       'pred_rebook_prep',
      horizon:  'soon',
      title:    '来週〜再来週に再来予約アプローチ',
      description: `推奨来店まであと${remaining}日。今週中にLINEで次回提案の準備を。`,
      triggerReason: `推奨サイクル${recommendedCycleDays}日の${remaining}日前`,
    })
  }

  // ── future（2〜4週間以内に必要） ────────────────────────────────────────

  // VIP化チャンス
  if (vipRank < 3 && visits >= 7 && lineResponseRate >= 70) {
    results.push({
      id:       'pred_vip_candidate',
      horizon:  'future',
      title:    'VIP化のアプローチを検討する時期',
      description: '来店回数・反応率からVIP化の素地ができています。特別感のある提案でランクアップを。',
      triggerReason: `来店${visits}回・LINE反応率${lineResponseRate}%`,
    })
  }

  // 季節ケア切り替え（肌タグ×季節）
  if (skinTags.includes('dry') || skinTags.includes('aging')) {
    const month = new Date().getMonth() + 1
    if (month >= 9 && month <= 10) {
      results.push({
        id:       'pred_season_care',
        horizon:  'future',
        title:    '秋冬ケアへの切り替え提案',
        description: '乾燥・エイジングケアの季節が近づいています。来月のコース変更提案を準備しましょう。',
        triggerReason: '秋以降の乾燥シーズン前',
      })
    }
  }

  // LINE 継続フォロー習慣化
  const hasRecentLine = recentActionTypes.some(t =>
    ['line_sent', 'next_action_line'].includes(t)
  )
  if (!hasRecentLine && lineResponseRate >= 60 && visits >= 3) {
    results.push({
      id:       'pred_line_habit',
      horizon:  'future',
      title:    '定期LINEフォロー習慣の開始',
      description: 'LINE反応率が良いお客様です。月1回の定期フォローを習慣化すると再来率が上がります。',
      triggerReason: `LINE反応率${lineResponseRate}%で定期フォロー効果が高い`,
    })
  }

  // 商品サイクル提案
  if (hasRecentPurchase) {
    results.push({
      id:       'pred_product_cycle',
      horizon:  'future',
      title:    '商品の使い切りタイミング確認',
      description: '前回購入から少し経ちます。「使い心地どうですか？」のLINEが次の購入につながります。',
      triggerReason: '商品購入後のフォローアップ',
    })
  }

  // スコア順（soon が先）・重複なし
  return results
    .filter((r, i, arr) => arr.findIndex(x => x.id === r.id) === i)
    .sort((a, b) => (a.horizon === 'soon' ? 0 : 1) - (b.horizon === 'soon' ? 0 : 1))
    .slice(0, maxCount)
}
