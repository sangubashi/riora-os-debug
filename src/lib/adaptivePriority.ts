/**
 * adaptivePriority.ts  — PHASE 10 最終版
 *
 * 「静かな知性」設計原則:
 *   1. 純粋関数のみ。副作用・fetch・UI依存は一切なし
 *   2. reasons を全補正に付与（デバッグ・テスト）
 *   3. critical/high は最大3つ — 超えたら静かに格下げ
 *   4. timePressure 時は情報量を積極削減
 *   5. 接客時間経過・顧客反応・完了アクションで動的変化
 *   6. AIが自動判断 — スタッフに設定させない
 */

import type {
  PriorityLevel,
  DisplaySection,
  SectionPriority,
  SectionPriorities,
} from '@/types'

// ─── 入力型 ──────────────────────────────────────────────────────────────────

export interface AdaptivePriorityInput {
  customer: {
    relationshipState:  string   // 'forming'|'growing'|'stable'|'cooling'|'at_risk'
    riskLevel:          'high' | 'medium' | 'low'
    visitCycle:         number   // 推奨サイクル日数
    customerTags:       string[]
    lastVisitAt?:       string   // ISO
    lineReplyRate:      number   // 0〜100
    purchaseTrend?:     'increasing' | 'stable' | 'decreasing'
  }
  activeSession: {
    servicePhase:       'counseling' | 'treatment' | 'aftercare' | 'checkout'
    timePressure:       boolean
    elapsedTime:        number   // 分（接客開始からの経過）
    completedActions:   string[]
  }
  currentContext?: {
    role:               'staff' | 'owner'
    device?:            'mobile' | 'tablet'
    activeSection?:     DisplaySection
  }
}

// ─── 内部型 ──────────────────────────────────────────────────────────────────

type ScoreRecord = { score: number; reasons: string[] }
type RawScores   = Record<DisplaySection, ScoreRecord>

// ─── スコア → PriorityLevel ────────────────────────────────────────────────────

const THRESHOLDS: Array<[number, PriorityLevel]> = [
  [85, 'critical'],
  [65, 'high'],
  [40, 'medium'],
  [18, 'low'],
  [ 0, 'hidden'],
]

function toPriority(score: number): PriorityLevel {
  for (const [t, l] of THRESHOLDS) if (score >= t) return l
  return 'hidden'
}

// ─── フェーズ基準スコア ────────────────────────────────────────────────────────
//
// 各フェーズで「今何が必要か」を表す出発点。
// ここから顧客状態・セッション状態・時間で動的に変化する。

const PHASE_BASE: Record<
  AdaptivePriorityInput['activeSession']['servicePhase'],
  Record<DisplaySection, number>
> = {
  // カウンセリング: 顧客理解フェーズ。AI提案・next action を前面に
  counseling: {
    aiInsight:             85,
    nextAction:            78,
    timeline:              65,
    riskCard:              60,
    storeLearning:         42,
    homecare:              38,
    homeCare:              38,
    lineDraft:             28,
    predictiveSuggestions: 32,
    voiceMemo:             14,
    serviceReplay:          6,
  },
  // 施術中: 静かに。ホームケア準備のみ
  treatment: {
    aiInsight:             38,
    nextAction:            25,
    timeline:              18,
    riskCard:              28,
    storeLearning:         20,
    homecare:              60,
    homeCare:              60,
    lineDraft:             16,
    predictiveSuggestions: 22,
    voiceMemo:             10,
    serviceReplay:          8,
  },
  // アフターケア: 次アクション・LINE・音声を前面に
  aftercare: {
    aiInsight:             55,
    nextAction:            88,
    timeline:              45,
    riskCard:              58,
    storeLearning:         40,
    homecare:              76,
    homeCare:              76,
    lineDraft:             80,
    predictiveSuggestions: 62,
    voiceMemo:             70,
    serviceReplay:         28,
  },
  // 退店: サービスリプレイ・音声・LINE が主役
  checkout: {
    aiInsight:             32,
    nextAction:            65,
    timeline:              25,
    riskCard:              42,
    storeLearning:         28,
    homecare:              52,
    homeCare:              52,
    lineDraft:             76,
    predictiveSuggestions: 40,
    voiceMemo:             86,
    serviceReplay:         92,
  },
}

// ─── 顧客状態補正 ─────────────────────────────────────────────────────────────

function applyCustomerDelta(
  raw:      RawScores,
  customer: AdaptivePriorityInput['customer']
): void {
  const {
    relationshipState, riskLevel, lineReplyRate,
    purchaseTrend, customerTags,
  } = customer

  const isAtRisk  = riskLevel === 'high'   || relationshipState === 'at_risk'
  const isCooling = riskLevel === 'medium' || relationshipState === 'cooling'

  // リスク状態
  if (isAtRisk) {
    add(raw, 'riskCard',   +28, 'at-risk: risk card critical')
    add(raw, 'nextAction', +25, 'at-risk: next action urgent')
    add(raw, 'lineDraft',  +22, 'at-risk: follow-up LINE critical')
  } else if (isCooling) {
    add(raw, 'riskCard',   +15, 'cooling: monitor closely')
    add(raw, 'nextAction', +12, 'cooling: proactive action')
    add(raw, 'lineDraft',  +10, 'cooling: warm LINE needed')
  }

  // LINE返信率による lineDraft 調整（低反応なら逆効果防止）
  if (lineReplyRate < 40) {
    add(raw, 'lineDraft', -22, `low LINE rate ${lineReplyRate}% — suppress draft`)
  } else if (lineReplyRate >= 80) {
    add(raw, 'lineDraft', +10, `high LINE rate ${lineReplyRate}% — draft effective`)
  }

  // 購入トレンド
  if (purchaseTrend === 'decreasing') {
    add(raw, 'nextAction',            +12, 'purchase declining — action needed')
    add(raw, 'predictiveSuggestions', +15, 'purchase declining — predict needs')
  } else if (purchaseTrend === 'increasing') {
    add(raw, 'storeLearning', +10, 'purchase increasing — learn pattern')
  }

  // 顧客タグ
  const hasSkin    = customerTags.some(t =>
    ['dry','oily','sensitive','acne','aging','pigmentation'].includes(t))
  const hasEvent   = customerTags.includes('event_before')
  const hasMotive  = customerTags.includes('high_motivation')
  const lowHomecare = customerTags.includes('low_homecare')

  if (hasSkin) {
    add(raw, 'homecare', +12, 'skin concern — homecare valuable')
    add(raw, 'homeCare', +12, 'skin concern — homecare valuable')
  }
  if (lowHomecare) {
    add(raw, 'homecare', +18, 'low homecare habit — guidance critical')
    add(raw, 'homeCare', +18, 'low homecare habit — guidance critical')
  }
  if (hasEvent) {
    add(raw, 'predictiveSuggestions', +20, 'event upcoming — predict needs')
    add(raw, 'lineDraft',              +12, 'event context — personalized LINE')
  }
  if (hasMotive) {
    add(raw, 'nextAction',    +10, 'high motivation — capitalize')
    add(raw, 'storeLearning',  +8, 'high motivation — pattern value')
  }

  // 関係性ステート
  switch (relationshipState) {
    case 'forming':
      add(raw, 'aiInsight', +10, 'forming — new customer needs AI guide')
      add(raw, 'voiceMemo', +15, 'forming — build early data')
      add(raw, 'timeline',  -10, 'forming — minimal history')
      break
    case 'growing':
      add(raw, 'aiInsight', +8,  'growing — reinforce momentum')
      add(raw, 'voiceMemo', +10, 'growing — enrich data')
      break
    case 'stable':
      add(raw, 'timeline',      +10, 'stable — rich history valuable')
      add(raw, 'storeLearning',  +8, 'stable — pattern analysis')
      break
  }
}

// ─── セッション補正（時間経過・完了アクション） ────────────────────────────────

function applySessionDelta(
  raw:     RawScores,
  session: AdaptivePriorityInput['activeSession']
): void {
  const { elapsedTime, completedActions } = session

  // ── 時間経過による動的変化（PHASE 10 強化点） ─────────────────────────────
  // 接客時間が経つほど「振り返り・記録」の重要度が上がる
  if (elapsedTime >= 75) {
    add(raw, 'serviceReplay', +20, `long session ${elapsedTime}min — replay critical`)
    add(raw, 'voiceMemo',     +15, `long session — capture now before forgetting`)
    add(raw, 'nextAction',     -8, `long session — action fatigue, de-emphasize`)
  } else if (elapsedTime >= 45) {
    add(raw, 'serviceReplay', +12, `mid-long session ${elapsedTime}min`)
    add(raw, 'voiceMemo',     +10, 'mid-long — voice memo valuable')
  } else if (elapsedTime >= 20) {
    add(raw, 'serviceReplay',  +6, `session progressing ${elapsedTime}min`)
  }

  // ── 完了アクション → 対応セクションを静かに退場させる ────────────────────
  // 「済んだことは見せない」= 接客テンポを崩さない
  const done = new Set(completedActions)

  if (done.has('line_sent') || done.has('next_action_line')) {
    add(raw, 'lineDraft', -35, 'LINE done — suppress draft')
  }
  if (done.has('homecare_explained') || done.has('next_action_homecare')) {
    add(raw, 'homecare', -28, 'homecare explained — suppress')
    add(raw, 'homeCare', -28, 'homecare explained — suppress')
  }
  if (done.has('rebook_recommended') || done.has('next_action_rebook')) {
    add(raw, 'nextAction', -18, 'rebook done — reduce next action')
  }
  if (done.has('voice_note_created')) {
    add(raw, 'voiceMemo', -25, 'voice note done')
  }
  if (done.has('product_purchased') || done.has('product_recommended')) {
    add(raw, 'predictiveSuggestions', -15, 'product done — predict less needed')
  }

  // ── 多くのアクションが完了 → 振り返りフェーズに移行 ─────────────────────
  if (completedActions.length >= 4) {
    add(raw, 'serviceReplay', +18, `${completedActions.length} actions done — time to replay`)
    add(raw, 'storeLearning', +12, 'many actions — learn from session')
    add(raw, 'aiInsight',      -8, 'many actions done — AI insight less needed')
  } else if (completedActions.length >= 2) {
    add(raw, 'serviceReplay', +8, `${completedActions.length} actions done — preview replay`)
  }
}

// ─── コンテキスト補正 ─────────────────────────────────────────────────────────

function applyContextDelta(
  raw:     RawScores,
  context: NonNullable<AdaptivePriorityInput['currentContext']>
): void {
  const { role, device } = context

  if (role === 'owner') {
    add(raw, 'storeLearning', +10, 'owner — store patterns relevant')
    add(raw, 'timeline',       +8, 'owner — timeline context')
  }

  if (device === 'tablet') {
    const sections: DisplaySection[] = ['timeline', 'predictiveSuggestions', 'storeLearning']
    for (const s of sections) add(raw, s, +8, 'tablet — more space')
  }
}

// ─── timePressure: 積極的な情報削減（PHASE 10 強化） ──────────────────────────
//
// 「接客テンポを絶対に崩さない」の中核。
// 次の予約まで時間がない時は、本当に必要なものだけ残す。

function applyTimePressure(raw: RawScores): void {
  const ALL = Object.keys(raw) as DisplaySection[]
  for (const s of ALL) {
    const score = raw[s].score
    if (score < 65) {
      // 3段階削減: 重要でないものほど強く押し下げる
      const reduction = score < 30 ? 30 : score < 45 ? 22 : 14
      add(raw, s, -reduction, `timePressure quiet: score ${score} → -${reduction}`)
    }
  }
}

// ─── 静かさの強制: critical/high を最大3つに抑制 ─────────────────────────────
//
// これが「AI が勝手に最適化する」の中核ロジック。
// スタッフは何も設定しなくても、常に3つ以内の重要情報だけが見える。

function enforceQuietness(raw: RawScores, maxSlots = 3): void {
  const sorted = (Object.keys(raw) as DisplaySection[])
    .map(s => ({ s, score: raw[s].score }))
    .sort((a, b) => b.score - a.score)

  let highCount = 0
  for (const { s, score } of sorted) {
    if (score >= 65) {
      highCount++
      if (highCount > maxSlots) {
        // 静かに medium の天井（64）に抑える
        const diff = 64 - raw[s].score
        add(raw, s, diff, `quietness: slot ${highCount}/${maxSlots} — capped to medium`)
      }
    }
  }
}

// ─── メイン関数 ───────────────────────────────────────────────────────────────

export function calculateSectionPriorities(
  input: AdaptivePriorityInput
): SectionPriorities {
  const { customer, activeSession, currentContext } = input

  const base = PHASE_BASE[activeSession.servicePhase]
  const raw  = initRaw(base)

  // 補正を順番に適用（順序が意味を持つ）
  applyCustomerDelta(raw, customer)
  applySessionDelta(raw, activeSession)
  if (currentContext) applyContextDelta(raw, currentContext)
  if (activeSession.timePressure) applyTimePressure(raw)

  // 最後に静かさを強制（timePressure 時はスロットを 2 に絞る）
  enforceQuietness(raw, activeSession.timePressure ? 2 : 3)

  // クランプ + PriorityLevel 変換
  const result = {} as SectionPriorities
  for (const section of Object.keys(raw) as DisplaySection[]) {
    const clamped = Math.max(0, Math.min(100, raw[section].score))
    result[section] = {
      level:   toPriority(clamped),
      score:   clamped,
      reasons: raw[section].reasons,
    }
  }

  return result
}

// ─── ヘルパー（外部公開） ──────────────────────────────────────────────────────

export function isHighPriority(p: SectionPriority): boolean {
  return p.level === 'critical' || p.level === 'high'
}

export function sortedByPriority(
  priorities: SectionPriorities
): Array<{ section: DisplaySection; priority: SectionPriority }> {
  return (Object.entries(priorities) as [DisplaySection, SectionPriority][])
    .map(([section, priority]) => ({ section, priority }))
    .sort((a, b) => b.priority.score - a.priority.score)
}

export function visibleSections(
  priorities:   SectionPriorities,
  timePressure: boolean
): DisplaySection[] {
  return (Object.entries(priorities) as [DisplaySection, SectionPriority][])
    .filter(([, p]) => timePressure ? isHighPriority(p) : p.level !== 'hidden')
    .sort(([, a], [, b]) => b.score - a.score)
    .map(([s]) => s)
}

// ─── 内部ヘルパー ─────────────────────────────────────────────────────────────

function initRaw(base: Record<DisplaySection, number>): RawScores {
  const raw = {} as RawScores
  for (const [s, score] of Object.entries(base)) {
    raw[s as DisplaySection] = { score, reasons: [`base:${score}`] }
  }
  return raw
}

function add(raw: RawScores, s: DisplaySection, delta: number, reason: string): void {
  if (!(s in raw)) raw[s] = { score: 0, reasons: [] }
  raw[s].score += delta
  if (reason) raw[s].reasons.push(reason)
}
