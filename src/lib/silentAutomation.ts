/**
 * silentAutomation.ts
 * 音声メモ停止後、裏側で自動実行される提案生成パイプライン。
 *
 * 「AIが前に出ない」設計：
 *   - 結果は VoiceMemoSection の onSuggestion コールバックで受け渡す
 *   - UIへの強制割り込みなし
 *   - エラー時は静かにフォールバック
 *
 * 生成内容:
 *   1. insight_tags（PHASE3 既存）
 *   2. NextAction 候補（PHASE4 既存）
 *   3. LINE下書きヒント
 *   4. 商品提案候補
 */

import { extractInsightTags } from '@/lib/voiceInsight/extractInsightTags'
import { extractMemoryCandidates, saveMemoryItems } from '@/lib/aiMemory'
import { generateNextActions } from '@/lib/nextAction/generateNextActions'
import type { SilentSuggestion, SkinTagKey, NextAction } from '@/types'

// ─── 入力型 ──────────────────────────────────────────────────────────────────

export interface SilentAutomationInput {
  customerId:          string
  staffId:             string | null
  transcript:          string | null
  summary:             string | null
  insightTags:         string[]       // 既に抽出済み（PHASE3）
  // 顧客コンテキスト（generateNextActions に渡す）
  visits:              number
  totalSales:          number
  lineResponseRate:    number
  vipRank:             number
  churnRisk:           number
  daysSinceLastVisit:  number
  skinTags:            SkinTagKey[]
  menuName:            string
  recommendedCycleDays?: number | null
}

// ─── LINE下書きヒント生成（deterministic） ────────────────────────────────────

function buildLineDraftHint(
  insightTags: string[],
  skinTags:    SkinTagKey[],
  menuName:    string
): string | null {
  // イベント前 → urgency のある文面
  if (insightTags.includes('event_before')) {
    return `イベント前のケアに触れた温かいフォローメッセージ`
  }
  // 乾燥タグ
  if (skinTags.includes('dry') || insightTags.includes('dryness_concern')) {
    return `乾燥が続く季節。保湿ケアを続けているか確認するLINE`
  }
  // 来店モチベ高
  if (insightTags.includes('high_motivation')) {
    return `来店への熱意を受け止めた感謝＋次回提案のLINE`
  }
  // 多忙
  if (insightTags.includes('busy_lifestyle')) {
    return `お忙しい中でのご来店への感謝。短めのLINE`
  }
  // メニューベースフォールバック
  if (menuName.includes('エイジング') || menuName.includes('プレミアム')) {
    return `${menuName}後のホームケア継続を応援するLINE`
  }
  return null
}

// ─── 商品提案候補（deterministic） ───────────────────────────────────────────

function buildProductHint(
  insightTags: string[],
  skinTags:    SkinTagKey[]
): string | null {
  if (insightTags.includes('event_before')) {
    return 'イベント前の集中ケアセット（美容液＋マスク）'
  }
  if (skinTags.includes('aging') || insightTags.includes('aging_concern')) {
    return 'ペプチド配合エイジングクリーム（夜用）'
  }
  if (skinTags.includes('dry') || insightTags.includes('dryness_concern')) {
    return 'セラミド高配合ウォータリーゲル'
  }
  if (skinTags.includes('acne') || insightTags.includes('acne_concern')) {
    return '抗炎症処方スポットジェル'
  }
  if (insightTags.includes('sensitive_skin') || skinTags.includes('sensitive')) {
    return '低刺激・セラミド配合敏感肌ローション'
  }
  return null
}

// ─── メイン: Silent Automation 実行 ──────────────────────────────────────────

export async function runSilentAutomation(
  input: SilentAutomationInput
): Promise<SilentSuggestion> {
  const { customerId, staffId, transcript, summary, insightTags, skinTags, menuName } = input

  // ── 並列実行 ────────────────────────────────────────────────────────────
  const [nextActionsResult, memoryResult] = await Promise.allSettled([
    generateNextActions({
      customerId:          input.customerId,
      visits:              input.visits,
      totalSales:          input.totalSales,
      lineResponseRate:    input.lineResponseRate,
      vipRank:             input.vipRank,
      churnRisk:           input.churnRisk,
      daysSinceLastVisit:  input.daysSinceLastVisit,
      skinTags:            input.skinTags,
      menuName:            input.menuName,
      recommendedCycleDays: input.recommendedCycleDays,
    }, 3),

    // AI Memory: transcript から記憶を抽出して保存
    (async () => {
      const text = [transcript, summary].filter(Boolean).join(' ')
      if (text.length < 10) return
      const candidates = extractMemoryCandidates(text)
      if (candidates.length > 0) {
        await saveMemoryItems(customerId, candidates)
      }
    })(),
  ])

  const nextActions: NextAction[] =
    nextActionsResult.status === 'fulfilled' ? nextActionsResult.value : []

  // ── 提案候補生成 ────────────────────────────────────────────────────────
  const lineDraftHint  = buildLineDraftHint(insightTags, skinTags, menuName)
  const productHint    = buildProductHint(insightTags, skinTags)

  return {
    insightTags,
    nextActions,
    lineDraftHint,
    productHint,
  }
}
