/**
 * lineMessageGenerator.ts
 *
 * 顧客データ + InsightGenerator の結果から
 * LINE メッセージを 4パターン生成する純粋関数。
 *
 * 設計方針:
 *   - 外部 API 不使用。ルールベース + テンプレート変数展開
 *   - 営業感を抑え「自然な美容アドバイス」口調
 *   - 4パターン: churn_prevention / vip_nurture / product_suggest / revisit
 *   - JSON で返す（useLineSendQueueStore に直接渡せる形式）
 */

import type { InsightGeneratorResult } from '@/lib/voiceInsight/InsightGenerator'

// ─── 入力型 ──────────────────────────────────────────────────────────────────

export interface LineMessageInput {
  customerName:   string
  visitCount:     number
  totalSpent:     number
  churnRisk:      number      // 0〜100
  vipRank:        number      // 0〜5
  daysSinceVisit: number      // 最終来店からの日数
  nextActionType?: string     // NextAction.type
  insight?:        InsightGeneratorResult | null
}

// ─── 出力型 ──────────────────────────────────────────────────────────────────

export type LineMessageType =
  | 'churn_prevention'  // 離脱防止
  | 'vip_nurture'       // VIP化
  | 'product_suggest'   // 店販提案
  | 'revisit'           // 来店促進

export type MessagePriority = 'high' | 'medium' | 'low'

export interface LineMessage {
  type:         LineMessageType
  priority:     MessagePriority
  message_title: string
  message_body:  string
  reason:        string    // 生成理由（スタッフ向け表示）
  tags:          string[]  // 関連タグ
}

export interface LineMessageGeneratorResult {
  messages:       LineMessage[]
  recommended:    LineMessage   // 最優先メッセージ
  generatedAt:    string
}

// ─── 姓を抽出するヘルパー ─────────────────────────────────────────────────────

function lastName(fullName: string): string {
  return fullName.split(/\s|　/)[0] ?? fullName
}

// ─── 文字数チェック ───────────────────────────────────────────────────────────

function trim(text: string, max = 300): string {
  return text.length > max ? text.slice(0, max) + '…' : text
}

// ─── パターン1: 離脱防止 ─────────────────────────────────────────────────────

function buildChurnPrevention(
  input: LineMessageInput
): LineMessage {
  const name     = lastName(input.customerName)
  const days     = input.daysSinceVisit
  const insight  = input.insight

  // 肌悩みが抽出されていれば個別アドバイスに使う
  const skinAdvice = (() => {
    if (!insight?.allTags) return null
    if (insight.allTags.includes('dryness_concern'))
      return '気温の変化で肌の乾燥が気になる季節になってきました。'
    if (insight.allTags.includes('aging_concern'))
      return 'ハリや透明感のケアはタイミングが大切です。'
    if (insight.allTags.includes('acne_concern'))
      return '毛穴ケアは定期的なケアで効果が持続しやすくなります。'
    return null
  })()

  const body = trim(
    `${name}様\n\n` +
    (skinAdvice ?? `お久しぶりです。`) +
    `\nいつもご来店ありがとうございます。\n\n` +
    (days >= 60
      ? `少し間が空いてしまいましたが、お肌の調子はいかがでしょうか？\nスタッフ一同、${name}様のご来店をお待ちしております。`
      : `次回のご予約はお決まりでしょうか？\nご都合の良い日時があればお気軽にお知らせください。`) +
    `\n\n─ Salon Riora`
  )

  return {
    type:          'churn_prevention',
    priority:      input.churnRisk >= 70 ? 'high' : 'medium',
    message_title: '久しぶりのご連絡',
    message_body:  body,
    reason:        `離脱リスク ${input.churnRisk}% / 最終来店 ${days}日前`,
    tags:          ['離脱防止', '来店促進'],
  }
}

// ─── パターン2: VIP化 ────────────────────────────────────────────────────────

function buildVipNurture(
  input: LineMessageInput
): LineMessage {
  const name = lastName(input.customerName)

  // 次回提案があればメッセージに組み込む
  const suggestion = input.insight?.suggestions[0]
  const treatmentLine = suggestion
    ? `次回は${suggestion.treatment}もおすすめです。${suggestion.reason}。`
    : `お肌の状態に合わせた施術をご提案できます。`

  const body = trim(
    `${name}様\n\n` +
    `いつもご来店いただきありがとうございます。\n` +
    `${name}様のお肌の変化をスタッフも楽しみながら拝見しています。\n\n` +
    treatmentLine + '\n\n' +
    (input.visitCount >= 8
      ? `定期的にご来店いただいているお客様には、より効果的なプランをご提案することもできます。`
      : `続けることで効果をより実感いただけます。次回もお待ちしております。`) +
    `\n\n─ Salon Riora`
  )

  return {
    type:          'vip_nurture',
    priority:      input.vipRank >= 2 ? 'high' : 'medium',
    message_title: 'お肌の変化について',
    message_body:  body,
    reason:        `VIPランク ${input.vipRank} / 来店 ${input.visitCount}回`,
    tags:          ['VIP化', '施術提案'],
  }
}

// ─── パターン3: 店販提案 ─────────────────────────────────────────────────────

function buildProductSuggest(
  input: LineMessageInput
): LineMessage {
  const name   = lastName(input.customerName)
  const insight = input.insight

  // 購入傾向に合わせた文言を変える
  const buyStyle = insight?.buyTendencies[0]?.style
  const ctaLine = (() => {
    if (buyStyle === '比較・検討派')
      return 'ご来店時にサンプルをお試しいただくこともできます。お気軽にスタッフまでお声がけください。'
    if (buyStyle === 'お試し好き')
      return 'まずは小さめサイズでお試しいただけるものもご用意しています。'
    if (buyStyle === 'リピート購入派')
      return 'いつもお使いいただいているアイテムの補充はいかがでしょうか。'
    return 'ご来店の際にご相談いただければ、お肌に合ったものをご提案します。'
  })()

  // NGワードがあれば価格トークを避ける
  const hasNgPrice = insight?.ngAlerts.some(n => n.tag === 'ng_price')

  const skinContext = (() => {
    if (!insight?.allTags) return '肌コンディションを整える'
    if (insight.allTags.includes('dryness_concern')) return '乾燥対策の'
    if (insight.allTags.includes('aging_concern'))   return 'エイジングケアの'
    if (insight.allTags.includes('acne_concern'))    return '毛穴・ニキビケアの'
    return 'お肌に合った'
  })()

  const body = trim(
    `${name}様\n\n` +
    `いつもありがとうございます。\n` +
    `${skinContext}ホームケアアイテムを一点ご紹介させていただきます。\n\n` +
    (hasNgPrice
      ? `効果を実感されているお客様からの口コミも増えています。`
      : `サロンでの施術と組み合わせることで、より長く効果を持続させることができます。`) +
    `\n\n` + ctaLine +
    `\n\n─ Salon Riora`
  )

  return {
    type:          'product_suggest',
    priority:      'medium',
    message_title: 'ホームケアのご提案',
    message_body:  body,
    reason:        `購入傾向: ${buyStyle ?? '未検出'} / NGワード: ${hasNgPrice ? '価格注意' : 'なし'}`,
    tags:          ['店販提案', 'ホームケア'],
  }
}

// ─── パターン4: 来店促進 ─────────────────────────────────────────────────────

function buildRevisit(
  input: LineMessageInput
): LineMessage {
  const name = lastName(input.customerName)
  const days = input.daysSinceVisit

  // 季節感を出す（月で簡易判定）
  const month = new Date().getMonth() + 1
  const seasonNote = (() => {
    if (month >= 3 && month <= 5)   return '春は紫外線が増えてくる季節です。'
    if (month >= 6 && month <= 8)   return '夏の紫外線ダメージが気になる季節です。'
    if (month >= 9 && month <= 11)  return '秋は肌の乾燥が始まりやすい時期です。'
    return '冬の乾燥がお肌に影響しやすい季節です。'
  })()

  const body = trim(
    `${name}様\n\n` +
    seasonNote + '\n' +
    (days >= 45
      ? `定期的なケアで肌の状態をキープできます。\nお時間のある際に、ぜひお立ち寄りいただければ嬉しいです。`
      : `次回のご来店はいつ頃をご検討でしょうか？\nスタッフ一同お待ちしております。`) +
    `\n\nご予約はLINEからでも承ります。\n\n─ Salon Riora`
  )

  return {
    type:          'revisit',
    priority:      days >= 60 ? 'high' : 'low',
    message_title: '次回ご来店のご案内',
    message_body:  body,
    reason:        `最終来店 ${days}日前 / 来店回数 ${input.visitCount}回`,
    tags:          ['来店促進', '季節ケア'],
  }
}

// ─── 優先度スコア計算 ─────────────────────────────────────────────────────────

const PRIORITY_SCORE: Record<MessagePriority, number> = {
  high: 3, medium: 2, low: 1,
}

// ─── メイン生成関数 ───────────────────────────────────────────────────────────

export function generateLineMessages(
  input: LineMessageInput
): LineMessageGeneratorResult {
  const messages: LineMessage[] = [
    buildChurnPrevention(input),
    buildVipNurture(input),
    buildProductSuggest(input),
    buildRevisit(input),
  ]

  // nextActionType に基づいて推奨メッセージを選ぶ
  const recommended = (() => {
    const type = input.nextActionType
    if (type?.includes('line') || type?.includes('churn') || input.churnRisk >= 60) {
      return messages.find(m => m.type === 'churn_prevention') ?? messages[0]
    }
    if (type?.includes('vip') || input.vipRank >= 2) {
      return messages.find(m => m.type === 'vip_nurture') ?? messages[0]
    }
    if (type?.includes('product') || type?.includes('retail')) {
      return messages.find(m => m.type === 'product_suggest') ?? messages[0]
    }
    // デフォルト: 優先度が最も高いものを返す
    return [...messages].sort(
      (a, b) => PRIORITY_SCORE[b.priority] - PRIORITY_SCORE[a.priority]
    )[0]
  })()

  return {
    messages,
    recommended,
    generatedAt: new Date().toISOString(),
  }
}
