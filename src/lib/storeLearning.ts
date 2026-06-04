/**
 * storeLearning.ts  — PHASE 10.1 / STEP 1
 * Store Learning Engine — 純粋関数・副作用なし
 *
 * 成功パターンから「このお客様・このフェーズに有効な知見」を抽出する。
 * fetch・DB・UI依存なし。テスト容易。
 */

import type {
  DisplaySection,
  StoreLearning,
  SuccessPattern,
} from '@/types/storeLearning'

// ─── 定数 ────────────────────────────────────────────────────────────────────

const MINIMUM_SAMPLE_SIZE = 5

// ─── 信頼度計算 ────────────────────────────────────────────────────────────────
// effectiveness × log スケールの sampleFactor
// sampleSize=5  → factor≈0.57,  sampleSize=20 → factor≈1.0

function calculateConfidence(
  effectiveness: number,
  sampleSize:    number
): number {
  const sampleFactor = Math.min(
    Math.log(sampleSize + 1) / Math.log(20),
    1
  )
  return Number((effectiveness * sampleFactor).toFixed(2))
}

// ─── 関連パターン判定 ─────────────────────────────────────────────────────────

function isRelevantPattern(
  pattern:      SuccessPattern,
  customerTags: string[]
): boolean {
  // 顧客タグが1つでも一致 → 関連あり
  return pattern.customerTags.some(tag => customerTags.includes(tag))
}

// ─── スコアソート（effectiveness × log(sampleSize) 降順） ────────────────────

function sortPatterns(a: SuccessPattern, b: SuccessPattern): number {
  const scoreA = a.effectiveness * Math.log(a.sampleSize + 1)
  const scoreB = b.effectiveness * Math.log(b.sampleSize + 1)
  return scoreB - scoreA
}

// ─── メイン関数 ───────────────────────────────────────────────────────────────

export function getStoreLearnings(
  patterns:     SuccessPattern[],
  customerTags: string[],
  servicePhase: string,
  limit = 3
): StoreLearning[] {

  // ① 関連 & サンプル数フィルタ → スコアソート → 上位20件を候補に
  const relevantPatterns = patterns
    .filter(p => isRelevantPattern(p, customerTags))
    .filter(p => p.sampleSize >= MINIMUM_SAMPLE_SIZE)
    .sort(sortPatterns)
    .slice(0, 20)

  const learnings: StoreLearning[] = []

  // ── ホームケア提案 ─────────────────────────────────────────────────────────
  const homecarePatterns = relevantPatterns.filter(
    p => p.actionType === 'ホームケア提案'
  )
  if (homecarePatterns.length > 0) {
    const top = homecarePatterns[0]
    learnings.push({
      section:        'homecare',
      recommendation: buildHomecareRec(top, customerTags),
      confidence:     calculateConfidence(top.effectiveness, top.sampleSize),
      reasons:        buildHomecareReasons(top),
      examplePatterns: homecarePatterns.slice(0, 2),
    })
  }

  // ── LINE送信（checkout フェーズ限定） ─────────────────────────────────────
  const linePatterns = relevantPatterns.filter(
    p => p.actionType === 'LINE送信'
  )
  if (linePatterns.length > 0 && servicePhase === 'checkout') {
    const top = linePatterns[0]
    learnings.push({
      section:        'lineDraft',
      recommendation: buildLineRec(top),
      confidence:     calculateConfidence(top.effectiveness, top.sampleSize),
      reasons:        buildLineReasons(top),
      examplePatterns: linePatterns.slice(0, 2),
    })
  }

  // ── 再来提案 ───────────────────────────────────────────────────────────────
  const revisitPatterns = relevantPatterns.filter(
    p => p.actionType === '再来提案'
  )
  if (revisitPatterns.length > 0) {
    const top = revisitPatterns[0]
    learnings.push({
      section:        'nextAction',
      recommendation: buildRevisitRec(top, servicePhase),
      confidence:     calculateConfidence(top.effectiveness, top.sampleSize),
      reasons:        buildRevisitReasons(top),
      examplePatterns: revisitPatterns.slice(0, 2),
    })
  }

  // ── 商品提案（aftercare / checkout のみ） ────────────────────────────────
  const productPatterns = relevantPatterns.filter(
    p => p.actionType === '商品提案'
  )
  if (
    productPatterns.length > 0 &&
    (servicePhase === 'aftercare' || servicePhase === 'checkout')
  ) {
    const top = productPatterns[0]
    learnings.push({
      section:        'storeLearning',
      recommendation: buildProductRec(top),
      confidence:     calculateConfidence(top.effectiveness, top.sampleSize),
      reasons:        buildProductReasons(top),
      examplePatterns: productPatterns.slice(0, 2),
    })
  }

  // 信頼度降順で返す
  return learnings
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit)
}

// ─── セクション別検索 ─────────────────────────────────────────────────────────

export function getLearningForSection(
  learnings: StoreLearning[],
  section:   DisplaySection
): StoreLearning | null {
  return learnings.find(l => l.section === section) ?? null
}

// ─── レコメンデーション文生成（deterministic） ─────────────────────────────────

function buildHomecareRec(top: SuccessPattern, customerTags: string[]): string {
  const isBusy   = customerTags.includes('busy_lifestyle')
  const isDry    = customerTags.includes('dry') || customerTags.includes('dryness_concern')
  const isAging  = customerTags.includes('aging') || customerTags.includes('aging_concern')

  if (top.staffStyle === '共感型') {
    return 'このタイプのお客様には、まずお悩みに共感してからホームケアを提案すると継続率が上がります'
  }
  if (isBusy) {
    return '忙しいお客様には「1分でできる保湿ルーティン」から始めると習慣化しやすい傾向があります'
  }
  if (isDry) {
    return '乾燥タイプのお客様には、朝の「セラム→乳液」2ステップの提案が定着率が高い傾向があります'
  }
  if (isAging) {
    return '夜のナイトケアに絞って提案すると、エイジングケアの実感が早く継続率も高い傾向があります'
  }
  return 'このタイプのお客様には、最初に「時短保湿ルーティン」を提案すると継続率が高い傾向があります'
}

function buildHomecareReasons(top: SuccessPattern): string[] {
  const reasons: string[] = [`成功事例 ${top.sampleSize}件`]
  if (top.staffStyle) reasons.push(`${top.staffStyle}スタイルで実績`)
  if (top.context.season) reasons.push(`${top.context.season}季節での効果確認`)
  if (top.outcome.reVisitRate) reasons.push(`再来率 ${top.outcome.reVisitRate}%`)
  return reasons
}

function buildLineRec(top: SuccessPattern): string {
  const mins = top.timing.minutesAfterService
  if (mins !== undefined && mins <= 15) {
    return `施術後${mins}分以内のフォローLINEが返信率向上につながっています`
  }
  if (top.timing.beforeCheckout) {
    return '会計前に次回予約の案内を添えたLINE送信が効果的な傾向があります'
  }
  return '施術後15分以内のフォローLINEが返信率向上につながっています'
}

function buildLineReasons(top: SuccessPattern): string[] {
  const reasons: string[] = []
  if (top.outcome.lineReplyRate != null) {
    reasons.push(`LINE返信率 ${top.outcome.lineReplyRate}%`)
  }
  reasons.push('来店直後の温度感維持')
  if (top.sampleSize >= 10) reasons.push(`${top.sampleSize}件の実績データ`)
  return reasons
}

function buildRevisitRec(top: SuccessPattern, servicePhase: string): string {
  if (servicePhase === 'treatment') {
    return '施術効果を伝えながら自然に次回の話題を出すと、会計前に予約が決まりやすい傾向があります'
  }
  if (top.timing.beforeCheckout) {
    return '会計直前の再来提案は断られにくく、予約取得率が高い傾向があります'
  }
  if (top.staffStyle === '提案型') {
    return '施術効果を説明した直後に次回来店導線を入れると再来率が高い傾向があります'
  }
  return '施術効果を説明した直後に次回来店導線を入れると再来率が高い傾向があります'
}

function buildRevisitReasons(top: SuccessPattern): string[] {
  const reasons: string[] = [`再来成功パターン ${top.sampleSize}件`]
  if (top.outcome.reVisitRate != null) reasons.push(`再来率 ${top.outcome.reVisitRate}%`)
  reasons.push('効果実感タイミングと一致')
  if (top.context.visitCycleDays) {
    reasons.push(`${top.context.visitCycleDays}日サイクルのお客様に有効`)
  }
  return reasons
}

function buildProductRec(top: SuccessPattern): string {
  if (top.staffStyle === '共感型') {
    return 'このタイプのお客様への商品提案は、お悩みへの共感を先に伝えてから行うと成約率が上がります'
  }
  if (top.outcome.salesUp != null && top.outcome.salesUp > 0) {
    return `商品提案を施術後に行うことで客単価 ${top.outcome.salesUp}%向上のパターンがあります`
  }
  return '施術後のホームケア説明と組み合わせた商品提案が、自然な流れで成約につながっています'
}

function buildProductReasons(top: SuccessPattern): string[] {
  const reasons: string[] = [`成功事例 ${top.sampleSize}件`]
  if (top.outcome.successScore >= 70) reasons.push(`成功スコア ${top.outcome.successScore}`)
  if (top.staffStyle) reasons.push(`${top.staffStyle}スタイルで実績`)
  return reasons
}
