/**
 * smartFollowDraft.ts  — PHASE 5
 * 顧客コンテキストから LINE下書き・フォロー内容・送信推奨タイミングを生成。
 *
 * 設計ルール:
 *   - 自動送信禁止。必ずスタッフ確認制
 *   - 押し売り感禁止
 *   - カウンセラー的トーン
 *   - 短文・季節感あり
 */

import type { RelationshipState, InsightTag, SkinTagKey } from '@/types'
import { getSeason } from '@/lib/homecare/generateHomecarePlan'

// ─── 入力型 ──────────────────────────────────────────────────────────────────

export interface SmartFollowInput {
  customerName:        string
  daysSinceLastVisit:  number
  recommendedCycleDays: number
  relationshipState:   RelationshipState
  skinTags:            SkinTagKey[]
  insightTags:         string[]
  menuName:            string
  lineResponseRate:    number
}

// ─── 出力型 ──────────────────────────────────────────────────────────────────

export interface SmartFollowDraft {
  draft:       string         // LINE下書き本文
  sendTiming:  string         // 「今日中に」「3日以内に」等
  tone:        string         // 「温かく共感型」「シンプル確認型」等
  reason:      string         // なぜこの内容にしたか（スタッフ向け説明）
}

// ─── 送信タイミング推定 ───────────────────────────────────────────────────────

function buildSendTiming(
  daysSinceLastVisit: number,
  recommendedCycleDays: number,
  relationshipState: RelationshipState
): string {
  const remaining = recommendedCycleDays - daysSinceLastVisit
  if (relationshipState === 'at_risk')  return '今日中に送信推奨'
  if (relationshipState === 'cooling')  return '2〜3日以内に送信推奨'
  if (remaining <= 3)                   return '今週中に送信推奨'
  if (daysSinceLastVisit >= 3 && daysSinceLastVisit <= 7) return '来店3〜7日後フォロー（今がベスト）'
  return `次回来店${remaining}日前に送信推奨`
}

// ─── トーン決定 ───────────────────────────────────────────────────────────────

function buildTone(
  lineResponseRate: number,
  relationshipState: RelationshipState
): string {
  if (lineResponseRate < 50)              return 'シンプル確認型（短め）'
  if (relationshipState === 'growing')    return '温かく共感型'
  if (relationshipState === 'at_risk')    return '親密・気にかけ型'
  if (relationshipState === 'stable')     return 'フレンドリー・自然型'
  return '丁寧・カジュアル型'
}

// ─── 本文生成 ─────────────────────────────────────────────────────────────────

export function generateSmartFollowDraft(input: SmartFollowInput): SmartFollowDraft {
  const {
    customerName, daysSinceLastVisit, recommendedCycleDays,
    relationshipState, skinTags, insightTags, menuName, lineResponseRate,
  } = input

  const firstName = customerName.replace(/\s+様?$/, '').split(/\s+/)[0] ?? customerName
  const season    = getSeason()
  const remaining = recommendedCycleDays - daysSinceLastVisit

  // ── ドラフト本文 ───────────────────────────────────────────────────────────
  const lines: string[] = []

  // 挨拶
  lines.push(`${firstName}さん、こんにちは🌸`)

  // 状態別オープニング
  if (relationshipState === 'at_risk') {
    lines.push(`最近いかがですか。お肌のことが気になって、ご連絡してみました。`)
  } else if (daysSinceLastVisit >= 3 && daysSinceLastVisit <= 7) {
    lines.push(`先日のご来店から少し経ちましたが、いかがでしょうか？`)
  } else if (remaining <= 7 && remaining > 0) {
    lines.push(`お肌のメンテナンス時期がそろそろ来ます。ご都合に合わせてご予約いただければ嬉しいです。`)
  } else if (daysSinceLastVisit > recommendedCycleDays) {
    lines.push(`少し間が空いてしまいましたが、お元気でしょうか😊`)
  }

  // 季節・肌タグ別ケアアドバイス
  const seasonTips: Record<string, Partial<Record<string, string>>> = {
    春: { dry: '春は花粉で肌が揺らぎやすいので保湿を強めに', acne: '春の肌荒れシーズン、清潔＋保湿を丁寧に', aging: '春から美白ケアを始めるとシミ予防に効果的です' },
    夏: { dry: '冷房の乾燥に注意。保湿ジェルをこまめに', oily: '夏はテカりやすいですが保湿は抜かさずに', pigmentation: '日焼け止め毎日忘れずに！' },
    秋: { dry: '夏ダメージの修復季節。しっかり保湿を', aging: '秋はエイジングケアのゴールデンタイムです' },
    冬: { dry: '乾燥しやすい季節なので保湿を強め意識してみてください', sensitive: '乾燥で敏感になりやすい時期、刺激を減らして' },
  }
  const primarySkinTag = skinTags[0]
  const seasonTip = primarySkinTag && seasonTips[season]?.[primarySkinTag]
  if (seasonTip) lines.push(seasonTip)

  // InsightTag 別フォロー
  if (insightTags.includes('event_before')) {
    lines.push(`イベント前のお肌、気になることがあればいつでもご相談ください✨`)
  } else if (insightTags.includes('busy_lifestyle')) {
    lines.push(`お忙しい中でも無理なくできるケアを続けてみてください。`)
  }

  // クロージング
  if (remaining <= 5 && remaining > 0) {
    lines.push(`次回のご来店、お待ちしております🗓️`)
  } else {
    lines.push(`ご不明な点はいつでもお気軽にどうぞ😊`)
  }

  const draft = lines.join('\n')

  return {
    draft,
    sendTiming: buildSendTiming(daysSinceLastVisit, recommendedCycleDays, relationshipState),
    tone:       buildTone(lineResponseRate, relationshipState),
    reason:     buildReason(relationshipState, insightTags, daysSinceLastVisit, menuName),
  }
}

// ─── 理由説明（スタッフ向け） ─────────────────────────────────────────────────

function buildReason(
  state:              RelationshipState,
  insightTags:        string[],
  daysSinceLastVisit: number,
  menuName:           string
): string {
  const reasons: string[] = []
  if (state === 'at_risk')              reasons.push('失客リスクがあるため積極的なアプローチを推奨')
  if (state === 'cooling')              reasons.push('最近の反応が落ちているため温かいフォローを')
  if (insightTags.includes('event_before'))   reasons.push('イベント前の来店需要を掘り起こすチャンス')
  if (insightTags.includes('high_motivation')) reasons.push('モチベーションが高い今がアプローチのベストタイミング')
  if (daysSinceLastVisit >= 3 && daysSinceLastVisit <= 7) reasons.push('来店後3〜7日はフォロー効果が最も高い時期')
  if (!reasons.length) reasons.push(`${menuName}の施術後ケアとして自然なフォロー`)
  return reasons.join('・')
}
