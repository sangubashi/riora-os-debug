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
  // PHASE UI-CLEANUP-3: LINE返信率という概念を撤去。来店間隔(cycleOverRate)・
  // 最終来店日(daysSinceLastVisit)・失客リスク(churnRisk)のみで判定・文言生成する。
  {
    id:    'line_low_response',
    type:  'line_follow',
    match: ({ daysSinceLastVisit, recommendedCycleDays, churnRisk }) => {
      const cycleOverRate = recommendedCycleDays > 0
        ? daysSinceLastVisit / recommendedCycleDays
        : 0
      return daysSinceLastVisit >= 14 && (cycleOverRate >= 1.2 || churnRisk >= 40)
    },
    score: ({ daysSinceLastVisit, churnRisk }) =>
      Math.round(Math.min(daysSinceLastVisit, 60) * 0.5 + churnRisk * 0.3),
    title: () => 'しばらく連絡が取れていません',
    desc:  ({ daysSinceLastVisit }) =>
      `前回来店から${daysSinceLastVisit}日経過しています。フォロー連絡を検討しましょう。`,
    reasons: ({ daysSinceLastVisit }) => [
      `前回来店${daysSinceLastVisit}日経過`,
      '来店間隔が空いています',
    ],
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
    title: ({ skinTags }) => `${skinTags[0]}の様子を聞いてみましょう`,
    desc:  ({ skinTags }) =>
      `${skinTags.slice(0,2).join('・')}について、その後の調子を確認する自然な会話のきっかけです。`,
    ctaLabel: '会話した',
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
        ? 'イベント・旅行前のご様子を伺いましょう'
        : '前向きなご様子について話してみましょう',
    desc:  ({ insightTags }) =>
      insightTags.includes('event_before')
        ? '音声メモからイベント前の予定が確認できています。「その後の準備はいかがですか？」と聞いてみましょう。'
        : '来店時のモチベーションが高い様子でした。今の気持ちを聞いてみるとよい会話になりそうです。',
    ctaLabel: '会話した',
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
    title: () => 'しばらくご来店のないお客様です',
    desc:  ({ daysSinceLastVisit }) =>
      `前回来店から${daysSinceLastVisit}日経っています。「その後お変わりありませんか？」とやさしく声をかけてみましょう。`,
    ctaLabel: 'メッセージ送信',
    logType:  'next_action_vip',
  },
  {
    id:    'vip_candidate',
    type:  'vip_follow',
    match: ({ visits, totalSales, vipRank }) =>
      vipRank < 3 && visits >= 8 && totalSales >= 100000,
    score: ({ visits, totalSales }) =>
      Math.min(45 + Math.floor(visits / 2) + Math.floor(totalSales / 10000), 75),
    title: () => '長くご愛顧いただいているお客様です',
    desc:  ({ visits }) =>
      `来店${visits}回のお客様です。日頃のご愛顧への感謝を一言お伝えしてみましょう。`,
    ctaLabel: '会話した',
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
    title: () => 'おうちでのケアの様子を聞いてみましょう',
    desc:  () =>
      '音声メモからホームケアがあまりできていない様子が伺えます。「おうちでのケアはどうですか？」と聞いてみましょう。',
    ctaLabel: '確認した',
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
    title: () => '乾燥の様子を聞いてみましょう',
    desc:  () =>
      '前回は乾燥が気になるご様子でした。「その後、乾燥は落ち着きましたか？」と一言確認してみましょう。',
    ctaLabel: '確認した',
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
    title: () => '継続来店への意欲を聞いてみましょう',
    desc:  ({ visits }) =>
      `来店${visits}回目のお客様です。「これからも続けたいですか？」など、今後のペースについて自然に聞いてみましょう。`,
    reasons: ({ visits }) => [`来店${visits}回`],
    ctaLabel: '会話した',
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
    title: () => '前回の商品の使い心地を聞いてみましょう',
    desc:  () => '前回購入済みのホームケア商品について、「その後の使い心地はいかがですか？」と確認する自然な会話のきっかけです。',
    reasons: ({ daysSinceLastVisit }) => [
      '店販購入履歴あり',
      `前回来店${daysSinceLastVisit}日経過`,
    ],
    ctaLabel: '会話した',
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
    title: () => 'ホームケアの状況を聞いてみましょう',
    desc:  ({ visits }) =>
      `来店${visits}回のお客様です。「おうちでのケアはどうされていますか？」と聞くと、自然にホームケアの話につながります。`,
    reasons: ({ visits }) => [`来店${visits}回`, '店販購入なし'],
    ctaLabel: '会話した',
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
    title: () => '日頃の感謝を伝えましょう',
    desc:  ({ visits }) =>
      `来店${visits}回、長くご愛顧いただいているお客様です。日頃の感謝と、いつもと変わりない様子かを一言確認しましょう。`,
    reasons: ({ visits }) => [`来店${visits}回`],
    ctaLabel: '会話した',
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
    title: () => 'いつもより間隔が空いています',
    desc:  ({ daysSinceLastVisit, recommendedCycleDays }) => {
      const over = daysSinceLastVisit - recommendedCycleDays
      return `通常${recommendedCycleDays}日サイクルのところ${over}日超過しています。「その後お変わりありませんか？」と丁寧に声をかけてみましょう。`
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
    title: () => 'おうちでのケアについて聞いてみましょう',
    desc:  () => '長くご愛顧いただいているお客様です。「おうちでのケアで気になることはありますか？」と聞いてみましょう。',
    reasons: ({ visits }) => [`来店${visits}回`, '店販未購入'],
    ctaLabel: '会話した',
    logType:  'retail_sold' as ActionType,
  },

  // risk 来店間隔がまだ軽度 → LINEフォロー
  // PHASE UI-CLEANUP-2: 判定条件・文言からLINE返信率を排除。
  // 来店間隔(cycleOverRate)・最終来店日(daysSinceLastVisit)・失客リスク(churnRisk)のみで判定する。
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
      const cycleOverRate = input.recommendedCycleDays > 0
        ? input.daysSinceLastVisit / input.recommendedCycleDays
        : 0
      return phase === 'risk' &&
        input.churnRisk < 80 &&
        cycleOverRate < 2.0 &&
        !input.recentActionTypes.includes('line_sent')
    },
    score: () => 90,
    title: () => 'LINEでフォローする',
    desc:  ({ daysSinceLastVisit }) =>
      `前回来店から${daysSinceLastVisit}日経過しています。「お肌の調子はいかがですか？」と自然な形でLINEしましょう。`,
    reasons: ({ daysSinceLastVisit }) => [
      `前回来店${daysSinceLastVisit}日経過`,
      '来店間隔が空いています',
    ],
    ctaLabel: 'LINE送信済み',
    logType:  'line_sent' as ActionType,
  },

  // risk 来店間隔が大幅超過・失客リスク高 → 直接フォロー
  // PHASE UI-CLEANUP-2: 判定条件・文言からLINE返信率を排除。
  // 来店間隔(cycleOverRate)・最終来店日(daysSinceLastVisit)・失客リスク(churnRisk)のみで判定する。
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
      const cycleOverRate = input.recommendedCycleDays > 0
        ? input.daysSinceLastVisit / input.recommendedCycleDays
        : 0
      return phase === 'risk' &&
        (input.churnRisk >= 80 || cycleOverRate >= 2.0) &&
        !input.recentActionTypes.includes('churn_followed')
    },
    score: () => 88,
    title: () => '直接フォローを検討する',
    desc:  () =>
      'しばらく連絡が取れていないため、フォロー連絡を検討しましょう。',
    reasons: ({ daysSinceLastVisit }) => [
      `前回来店${daysSinceLastVisit}日経過`,
      '失客リスクが高まっています',
    ],
    ctaLabel: 'フォロー済み',
    logType:  'churn_followed' as ActionType,
  },
]
