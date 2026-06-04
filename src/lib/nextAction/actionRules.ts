/**
 * actionRules.ts
 * NextAction の判定ルールセット。
 *
 * 各ルールは「条件 → スコア加算」の形式で定義。
 * 純粋なデータ定義ファイル。ロジックは scoreActionPriority.ts に集約。
 */

import type { NextActionType, ActionType } from '@/types'
import { calcCustomerPhase } from '@/lib/phase5/customerRiskEngine'

// ─── ルール入力型（判定に使う全フィールド） ───────────────────────────────────

export interface ActionRuleInput {
  // 顧客基本
  customerId:           string
  visits:               number
  totalSales:           number
  lineResponseRate:     number    // 0〜100
  vipRank:              number    // 0〜5
  churnRisk:            number    // 0〜100
  // 来店
  daysSinceLastVisit:   number    // 最終来店からの日数
  recommendedCycleDays: number    // 推奨来店サイクル（日）
  // タグ
  skinTags:             string[]
  insightTags:          string[]
  // 商品購入
  hasRecentPurchase:    boolean   // 直近90日以内の購入あり
  // 過去アクション（直近30日）
  recentActionTypes:    string[]  // ActionType[]の実績
}

// ─── ルール定義型 ───────────────────────────────────────────────────────────

export interface ActionRule {
  /** ルールID */
  id:      string
  /** 対象アクションタイプ */
  type:    NextActionType
  /** このルールが適用されるか判定 */
  match:   (input: ActionRuleInput) => boolean
  /** スコア加算値（0〜100） */
  score:   (input: ActionRuleInput) => number
  /** タイトル生成 */
  title:   (input: ActionRuleInput) => string
  /** 説明生成 */
  desc:    (input: ActionRuleInput) => string
  /** 提案理由タグ生成（顧客データに応じた理由を返す） */
  reasons?: (input: ActionRuleInput) => string[]
  /** CTAボタンラベル */
  ctaLabel: string
  /** action_logs に記録する type */
  logType:  ActionType
}

// ─── ルール一覧 ─────────────────────────────────────────────────────────────

export const ACTION_RULES: ActionRule[] = [

  // ──────────────────────────────────────────────────────
  // 離脱リスク（最優先）
  // ──────────────────────────────────────────────────────
  {
    id:     'inactive_high',
    type:   'inactive_risk',
    match:  ({ daysSinceLastVisit, recommendedCycleDays }) =>
      daysSinceLastVisit >= recommendedCycleDays * 1.5,
    score:  ({ daysSinceLastVisit, recommendedCycleDays }) => {
      const overRate = daysSinceLastVisit / recommendedCycleDays
      return Math.min(Math.round(overRate * 30), 95)
    },
    title:  ({ daysSinceLastVisit }) =>
      `離脱リスク — ${daysSinceLastVisit}日未来店`,
    desc:   ({ recommendedCycleDays, daysSinceLastVisit }) =>
      `推奨サイクル${recommendedCycleDays}日を${daysSinceLastVisit - recommendedCycleDays}日超過。今日中にLINEでアプローチが必要です。`,
    ctaLabel: 'LINE下書き作成',
    logType:  'next_action_inactive',
  },

  // ──────────────────────────────────────────────────────
  // LINE フォロー
  // ──────────────────────────────────────────────────────
  {
    id:    'line_low_response',
    type:  'line_follow',
    match: ({ lineResponseRate, daysSinceLastVisit }) =>
      lineResponseRate < 60 && daysSinceLastVisit >= 14,
    score: ({ lineResponseRate, daysSinceLastVisit }) =>
      Math.round((100 - lineResponseRate) * 0.4 + Math.min(daysSinceLastVisit, 60) * 0.3),
    title: () => 'LINE返信率が低下しています',
    desc:  ({ lineResponseRate }) =>
      `LINE反応率 ${lineResponseRate}%。パーソナライズしたメッセージで接点を作りましょう。`,
    ctaLabel: 'LINE下書き作成',
    logType:  'next_action_line',
  },
  {
    id:    'line_post_visit',
    type:  'line_follow',
    match: ({ daysSinceLastVisit, recentActionTypes }) =>
      daysSinceLastVisit >= 3 &&
      daysSinceLastVisit <= 7 &&
      !recentActionTypes.includes('line_sent') &&
      !recentActionTypes.includes('next_action_line'),
    score: () => 72,
    title: () => '来店後フォローLINE',
    desc:  ({ daysSinceLastVisit }) =>
      `来店から${daysSinceLastVisit}日経過。ホームケアの調子を聞くLINEが効果的です。`,
    ctaLabel: 'LINE下書き作成',
    logType:  'next_action_line',
  },

  // ──────────────────────────────────────────────────────
  // 再来提案
  // ──────────────────────────────────────────────────────
  {
    id:    'rebook_approaching',
    type:  'rebook',
    match: ({ daysSinceLastVisit, recommendedCycleDays }) => {
      const remaining = recommendedCycleDays - daysSinceLastVisit
      return remaining >= 0 && remaining <= 10
    },
    score: ({ daysSinceLastVisit, recommendedCycleDays }) => {
      const remaining = recommendedCycleDays - daysSinceLastVisit
      return Math.round(80 - remaining * 3)
    },
    title: ({ daysSinceLastVisit, recommendedCycleDays }) => {
      const remaining = recommendedCycleDays - daysSinceLastVisit
      return remaining <= 3
        ? `再来適期！あと${remaining}日`
        : `再来推奨タイミングが近づいています`
    },
    desc:  ({ recommendedCycleDays, daysSinceLastVisit }) => {
      const remaining = recommendedCycleDays - daysSinceLastVisit
      return `推奨サイクル${recommendedCycleDays}日まであと${remaining}日。次回予約を促しましょう。`
    },
    ctaLabel: '提案完了',
    logType:  'next_action_rebook',
  },

  // ──────────────────────────────────────────────────────
  // 商品提案
  // ──────────────────────────────────────────────────────
  {
    id:    'product_skin_tag',
    type:  'product_offer',
    match: ({ skinTags, hasRecentPurchase, recentActionTypes }) =>
      skinTags.length > 0 &&
      !hasRecentPurchase &&
      !recentActionTypes.includes('product_recommended') &&
      !recentActionTypes.includes('next_action_product'),
    score: ({ skinTags }) => Math.min(50 + skinTags.length * 8, 78),
    title: ({ skinTags }) => `${skinTags[0]}ケアの商品提案チャンス`,
    desc:  ({ skinTags }) =>
      `${skinTags.slice(0,2).join('・')}の悩みに合った商品を提案するタイミングです。`,
    ctaLabel: '提案完了',
    logType:  'next_action_product',
  },
  {
    id:    'product_insight_tag',
    type:  'product_offer',
    match: ({ insightTags, hasRecentPurchase }) =>
      (insightTags.includes('high_motivation') || insightTags.includes('event_before')) &&
      !hasRecentPurchase,
    score: ({ insightTags }) =>
      insightTags.includes('event_before') ? 82 : 68,
    title: ({ insightTags }) =>
      insightTags.includes('event_before')
        ? 'イベント前：商品提案の絶好機'
        : 'モチベ高め：商品提案が刺さりやすい',
    desc:  ({ insightTags }) =>
      insightTags.includes('event_before')
        ? '音声メモからイベント前需要が確認できています。特別ケアセットを提案しましょう。'
        : '来店モチベーションが高い今が商品提案のベストタイミングです。',
    ctaLabel: '提案完了',
    logType:  'next_action_product',
  },

  // ──────────────────────────────────────────────────────
  // VIPフォロー
  // ──────────────────────────────────────────────────────
  {
    id:    'vip_follow',
    type:  'vip_follow',
    match: ({ vipRank, daysSinceLastVisit, recentActionTypes }) =>
      vipRank >= 3 &&
      daysSinceLastVisit >= 20 &&
      !recentActionTypes.includes('next_action_vip'),
    score: ({ vipRank, daysSinceLastVisit }) =>
      Math.min(55 + vipRank * 5 + Math.min(daysSinceLastVisit, 30), 88),
    title: () => 'VIP様への特別フォロー',
    desc:  ({ daysSinceLastVisit }) =>
      `VIPお客様が${daysSinceLastVisit}日未来店。特別感のあるパーソナルメッセージを送りましょう。`,
    ctaLabel: '特別メッセージ作成',
    logType:  'next_action_vip',
  },
  {
    id:    'vip_candidate',
    type:  'vip_follow',
    match: ({ visits, totalSales, vipRank }) =>
      vipRank < 3 && visits >= 8 && totalSales >= 100000,
    score: ({ visits, totalSales }) =>
      Math.min(45 + Math.floor(visits / 2) + Math.floor(totalSales / 10000), 75),
    title: () => 'VIP化候補 — 関係強化チャンス',
    desc:  ({ visits, totalSales }) =>
      `来店${visits}回・累計¥${totalSales.toLocaleString('ja-JP')}。VIP化に向けた特別ケアを提案しましょう。`,
    ctaLabel: '特別提案完了',
    logType:  'next_action_vip',
  },

  // ──────────────────────────────────────────────────────
  // ホームケアフォロー
  // ──────────────────────────────────────────────────────
  {
    id:    'homecare_low',
    type:  'homecare_follow',
    match: ({ insightTags, recentActionTypes }) =>
      insightTags.includes('low_homecare') &&
      !recentActionTypes.includes('homecare_explained') &&
      !recentActionTypes.includes('next_action_homecare'),
    score: () => 65,
    title: () => 'ホームケア習慣のフォロー',
    desc:  () =>
      '音声メモからホームケア不足が確認されています。具体的な方法を伝えてリピート率を高めましょう。',
    ctaLabel: '説明完了',
    logType:  'next_action_homecare',
  },
  {
    id:    'homecare_dry_skin',
    type:  'homecare_follow',
    match: ({ skinTags, insightTags, recentActionTypes }) =>
      (skinTags.includes('dry') || insightTags.includes('dryness_concern')) &&
      !recentActionTypes.includes('homecare_explained') &&
      !recentActionTypes.includes('next_action_homecare'),
    score: ({ insightTags }) =>
      insightTags.includes('dryness_concern') ? 70 : 58,
    title: () => '乾燥ケアのフォロー提案',
    desc:  () =>
      '乾燥肌への具体的なホームケア手順を伝えることで、次回来店時の肌状態改善に繋がります。',
    ctaLabel: '説明完了',
    logType:  'next_action_homecare',
  },

  // ─── フェーズ別 AI 提案 ────────────────────────────────────────────────────

  // new: 次回予約提案
  {
    id:    'phase_new_rebook',
    type:  'phase_new_rebook' as NextActionType,
    match: (input) => {
      const phase = calcCustomerPhase({
        visits: input.visits, totalSales: input.totalSales,
        vipRank: input.vipRank, churnRisk: input.churnRisk,
        daysSinceLastVisit: input.daysSinceLastVisit,
        recommendedCycleDays: input.recommendedCycleDays,
      })
      return phase === 'new' && !input.recentActionTypes.includes('next_reserved')
    },
    score: () => 82,
    title: () => '次回予約を提案する',
    desc:  ({ visits }) =>
      `来店${visits}回目のお客様には来店後すぐの次回予約提案が継続率を高めます。「次回はいつ頃がご都合よいですか？」と自然に聞いてみましょう。`,
    reasons: ({ visits, daysSinceLastVisit }) => [
      `来店${visits}回目`,
      daysSinceLastVisit > 0 ? `前回来店${daysSinceLastVisit}日経過` : '初来店',
    ],
    ctaLabel: '予約提案済み',
    logType:  'rebook_recommended' as ActionType,
  },

  // growing: 回数券提案
  {
    id:    'phase_growing_course',
    type:  'phase_growing_course' as NextActionType,
    match: (input) => {
      const phase = calcCustomerPhase({
        visits: input.visits, totalSales: input.totalSales,
        vipRank: input.vipRank, churnRisk: input.churnRisk,
        daysSinceLastVisit: input.daysSinceLastVisit,
        recommendedCycleDays: input.recommendedCycleDays,
      })
      return phase === 'growing' && !input.recentActionTypes.includes('next_action_product')
    },
    score: () => 75,
    title: () => '回数券・コース提案',
    desc:  ({ visits, totalSales }) => {
      const avg = visits > 0 ? Math.round(totalSales / visits / 1000) : 0
      return `来店${visits}回・平均単価${avg}千円のお客様は継続意欲が高まっています。回数券で来店固定化を図りましょう。`
    },
    reasons: ({ visits, totalSales }) => {
      const avg = visits > 0 ? Math.round(totalSales / visits / 1000) : 0
      return [`来店${visits}回`, `平均単価${avg}千円`]
    },
    ctaLabel: '提案済み',
    logType:  'option_sold' as ActionType,
  },

  // repeat 購入履歴あり → 店販リピート
  {
    id:    'phase_repeat_product_repeat',
    type:  'phase_repeat_product' as NextActionType,
    match: (input) => {
      const phase = calcCustomerPhase({
        visits: input.visits, totalSales: input.totalSales,
        vipRank: input.vipRank, churnRisk: input.churnRisk,
        daysSinceLastVisit: input.daysSinceLastVisit,
        recommendedCycleDays: input.recommendedCycleDays,
      })
      return phase === 'repeat' && input.hasRecentPurchase
    },
    score: () => 74,
    title: () => '前回お試し商品のリピート提案',
    desc:  () => '前回購入済みのホームケア商品の使い心地を確認し、リピート購入やステップアップ商品を提案しましょう。',
    reasons: ({ daysSinceLastVisit }) => [
      '店販購入履歴あり',
      `前回来店${daysSinceLastVisit}日経過`,
    ],
    ctaLabel: '提案済み',
    logType:  'retail_sold' as ActionType,
  },

  // repeat 購入履歴なし → 店販初回提案
  {
    id:    'phase_repeat_product_first',
    type:  'phase_repeat_product' as NextActionType,
    match: (input) => {
      const phase = calcCustomerPhase({
        visits: input.visits, totalSales: input.totalSales,
        vipRank: input.vipRank, churnRisk: input.churnRisk,
        daysSinceLastVisit: input.daysSinceLastVisit,
        recommendedCycleDays: input.recommendedCycleDays,
      })
      return phase === 'repeat' && !input.hasRecentPurchase
    },
    score: () => 71,
    title: () => 'ホームケア商品を初提案する',
    desc:  ({ visits }) =>
      `来店${visits}回のお客様はまだ店販未購入です。施術効果を高めるホームケアとして自然に提案するタイミングです。`,
    reasons: ({ visits }) => [`来店${visits}回`, '店販購入なし'],
    ctaLabel: '提案済み',
    logType:  'retail_sold' as ActionType,
  },

  // vip 売上高 → プレミアムコース
  {
    id:    'phase_vip_premium',
    type:  'phase_vip_premium' as NextActionType,
    match: (input) => {
      const phase = calcCustomerPhase({
        visits: input.visits, totalSales: input.totalSales,
        vipRank: input.vipRank, churnRisk: input.churnRisk,
        daysSinceLastVisit: input.daysSinceLastVisit,
        recommendedCycleDays: input.recommendedCycleDays,
      })
      return phase === 'vip' &&
        input.totalSales >= 500000 &&
        !input.recentActionTypes.includes('next_action_vip')
    },
    score: () => 87,
    title: () => 'プレミアムコースを案内する',
    desc:  ({ totalSales }) => {
      const man = Math.round(totalSales / 10000)
      return `累計${man}万円のVIPのお客様には特別感を演出したプレミアムコースが刺さります。「他のお客様より一歩先のケア」として案内しましょう。`
    },
    reasons: ({ totalSales, visits }) => {
      const man = Math.round(totalSales / 10000)
      return [`累計${man}万円`, `来店${visits}回`]
    },
    ctaLabel: '案内済み',
    logType:  'next_action_vip' as ActionType,
  },

  // vip 来店周期延びている → 来店フォロー
  {
    id:    'phase_vip_cycle_followup',
    type:  'phase_vip_premium' as NextActionType,
    match: (input) => {
      const phase = calcCustomerPhase({
        visits: input.visits, totalSales: input.totalSales,
        vipRank: input.vipRank, churnRisk: input.churnRisk,
        daysSinceLastVisit: input.daysSinceLastVisit,
        recommendedCycleDays: input.recommendedCycleDays,
      })
      const cycleOver = input.recommendedCycleDays > 0 &&
        input.daysSinceLastVisit > input.recommendedCycleDays * 1.2
      return phase === 'vip' && cycleOver &&
        !input.recentActionTypes.includes('next_action_vip')
    },
    score: () => 83,
    title: () => 'VIPお客様に来店フォロー',
    desc:  ({ daysSinceLastVisit, recommendedCycleDays }) => {
      const over = daysSinceLastVisit - recommendedCycleDays
      return `通常${recommendedCycleDays}日サイクルのところ${over}日超過しています。VIPのお客様を失客しないよう丁寧にフォローしましょう。`
    },
    reasons: ({ daysSinceLastVisit, recommendedCycleDays }) => [
      `来店${daysSinceLastVisit}日経過`,
      `推奨サイクル${recommendedCycleDays}日超過`,
    ],
    ctaLabel: 'フォロー済み',
    logType:  'next_action_vip' as ActionType,
  },

  // vip 店販率低い → ホームケア提案
  {
    id:    'phase_vip_homecare',
    type:  'phase_vip_premium' as NextActionType,
    match: (input) => {
      const phase = calcCustomerPhase({
        visits: input.visits, totalSales: input.totalSales,
        vipRank: input.vipRank, churnRisk: input.churnRisk,
        daysSinceLastVisit: input.daysSinceLastVisit,
        recommendedCycleDays: input.recommendedCycleDays,
      })
      return phase === 'vip' &&
        !input.hasRecentPurchase &&
        input.totalSales < 500000 &&
        !input.recentActionTypes.includes('next_action_product')
    },
    score: () => 78,
    title: () => 'VIPお客様にホームケア提案',
    desc:  () => 'VIPのお客様ですが店販購入がありません。施術効果を自宅でも継続できるホームケアセットをご提案する絶好のタイミングです。',
    reasons: ({ visits }) => [`来店${visits}回`, '店販未購入'],
    ctaLabel: '提案済み',
    logType:  'retail_sold' as ActionType,
  },

  // risk LINE返信率高い → LINEフォロー
  {
    id:    'phase_risk_line',
    type:  'phase_risk_line' as NextActionType,
    match: (input) => {
      const phase = calcCustomerPhase({
        visits: input.visits, totalSales: input.totalSales,
        vipRank: input.vipRank, churnRisk: input.churnRisk,
        daysSinceLastVisit: input.daysSinceLastVisit,
        recommendedCycleDays: input.recommendedCycleDays,
      })
      return phase === 'risk' &&
        input.lineResponseRate >= 40 &&
        !input.recentActionTypes.includes('line_sent')
    },
    score: () => 90,
    title: () => 'LINEでフォローする',
    desc:  ({ lineResponseRate, daysSinceLastVisit }) =>
      `LINE返信率${lineResponseRate}%と高いお客様です。前回来店${daysSinceLastVisit}日経過しています。「お肌の調子はいかがですか？」と自然な形でLINEしましょう。`,
    reasons: ({ lineResponseRate, daysSinceLastVisit }) => [
      `前回来店${daysSinceLastVisit}日経過`,
      `LINE返信率${lineResponseRate}%`,
    ],
    ctaLabel: 'LINE送信済み',
    logType:  'line_sent' as ActionType,
  },

  // risk LINE返信率低い → 電話フォロー
  {
    id:    'phase_risk_call',
    type:  'phase_risk_line' as NextActionType,
    match: (input) => {
      const phase = calcCustomerPhase({
        visits: input.visits, totalSales: input.totalSales,
        vipRank: input.vipRank, churnRisk: input.churnRisk,
        daysSinceLastVisit: input.daysSinceLastVisit,
        recommendedCycleDays: input.recommendedCycleDays,
      })
      return phase === 'risk' &&
        input.lineResponseRate < 40 &&
        !input.recentActionTypes.includes('churn_followed')
    },
    score: () => 88,
    title: () => '直接フォローを検討する',
    desc:  ({ lineResponseRate, daysSinceLastVisit }) =>
      `LINE返信率${lineResponseRate}%と低めです。前回来店${daysSinceLastVisit}日経過しており、LINEよりも直接のご連絡やDMが効果的かもしれません。`,
    reasons: ({ lineResponseRate, daysSinceLastVisit }) => [
      `前回来店${daysSinceLastVisit}日経過`,
      `LINE返信率${lineResponseRate}%`,
    ],
    ctaLabel: 'フォロー済み',
    logType:  'churn_followed' as ActionType,
  },
]
