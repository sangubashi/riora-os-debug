/**
 * InsightGenerator.ts
 *
 * voice_notes.transcript / summary / insight_tags を入力に
 *   - 次回提案 （suggest_* タグ → 具体的な提案文）
 *   - NGワード  （ng_* タグ → スタッフへの注意文）
 *   - 購入傾向  （buy_* タグ → 接客スタイルアドバイス）
 * を生成する純粋関数モジュール。
 *
 * 外部API不使用。キーワードマッチング + ルールベースで動作。
 */

import type { InsightTag } from '@/types'
import { extractInsightTags } from './extractInsightTags'

// ─── 出力型 ──────────────────────────────────────────────────────────────────

export interface NextServiceSuggestion {
  treatment:   string    // 提案施術名
  reason:      string    // 提案理由（顧客の悩みから）
  priority:    'high' | 'medium' | 'low'
  tag:         InsightTag
}

export interface NgWordAlert {
  topic:    string    // NGになりやすいトピック
  caution:  string    // スタッフへの注意文
  severity: 'warn' | 'info'
  tag:      InsightTag
}

export interface PurchaseTendency {
  style:   string    // 購入スタイル名
  advice:  string    // 接客アドバイス
  tag:     InsightTag
}

export interface InsightGeneratorResult {
  suggestions:  NextServiceSuggestion[]
  ngAlerts:     NgWordAlert[]
  buyTendencies: PurchaseTendency[]
  allTags:       InsightTag[]
  summary:       string   // 1行まとめ
}

// ─── 次回提案ルール ───────────────────────────────────────────────────────────

const SUGGESTION_MAP: Record<string, NextServiceSuggestion> = {
  suggest_peel: {
    treatment: 'ハーブピーリング',
    reason:    'くすみ・角質が気になるとの発言あり',
    priority:  'high',
    tag:       'suggest_peel',
  },
  suggest_whitening: {
    treatment: 'ホワイトニングケア',
    reason:    'シミ・美白への関心が高い',
    priority:  'high',
    tag:       'suggest_whitening',
  },
  suggest_premium: {
    treatment: 'プレミアムエイジングケア',
    reason:    '効果をより実感したいという意欲あり',
    priority:  'medium',
    tag:       'suggest_premium',
  },
  suggest_homecare: {
    treatment: 'ホームケアセット提案',
    reason:    '日常のスキンケアを見直したい意向あり',
    priority:  'medium',
    tag:       'suggest_homecare',
  },
  suggest_rebook: {
    treatment: '早期次回予約',
    reason:    '継続意欲が高いため次回予約をその場で取る',
    priority:  'high',
    tag:       'suggest_rebook',
  },
  // 肌悩みタグからの提案
  dryness_concern: {
    treatment: 'モイスチャーフェイシャル',
    reason:    '乾燥・うるおい不足の悩みあり',
    priority:  'high',
    tag:       'dryness_concern',
  },
  aging_concern: {
    treatment: 'プレミアムエイジングケア',
    reason:    'エイジングケアへの関心が高い',
    priority:  'high',
    tag:       'aging_concern',
  },
  acne_concern: {
    treatment: 'ハーブピーリング',
    reason:    'ニキビ・毛穴の詰まりが気になるとのこと',
    priority:  'high',
    tag:       'acne_concern',
  },
  low_homecare: {
    treatment: 'ホームケアセット提案',
    reason:    '自宅でのスキンケアが不足している',
    priority:  'medium',
    tag:       'low_homecare',
  },
}

// ─── NGワードルール ───────────────────────────────────────────────────────────

const NG_MAP: Record<string, NgWordAlert> = {
  ng_price: {
    topic:    '価格に関する発言',
    caution:  '「高すぎる」という発言が検出されました。次回は価格以外の価値（効果・体験）を先に伝えるアプローチが有効です。',
    severity: 'warn',
    tag:      'ng_price',
  },
  ng_compare: {
    topic:    '他サロンとの比較',
    caution:  '他のサロンへの言及があります。比較されている点を把握し、当サロンの強みを自然に伝えましょう。',
    severity: 'warn',
    tag:      'ng_compare',
  },
  ng_time: {
    topic:    '時間・提案への圧迫感',
    caution:  '時間的プレッシャーや勧めすぎと感じている可能性があります。次回はゆとりある接客を意識してください。',
    severity: 'warn',
    tag:      'ng_time',
  },
  price_sensitive: {
    topic:    '価格感度が高め',
    caution:  '費用への意識が高い顧客です。提案時は効果・コスパを具体的に説明すると納得感が高まります。',
    severity: 'info',
    tag:      'price_sensitive',
  },
}

// ─── 購入傾向ルール ───────────────────────────────────────────────────────────

const BUY_MAP: Record<string, PurchaseTendency> = {
  buy_impulse: {
    style:  '衝動買い傾向',
    advice: 'その場の感動が購入につながりやすい顧客です。施術直後に「今日から使えます」と自然に案内しましょう。',
    tag:    'buy_impulse',
  },
  buy_compare: {
    style:  '比較・検討派',
    advice: '持ち帰って考えるタイプです。パンフレットやLINEでの情報提供を準備し、後日フォローアップしましょう。',
    tag:    'buy_compare',
  },
  buy_loyal: {
    style:  'リピート購入派',
    advice: 'お気に入りを繰り返し購入する傾向があります。定番商品の在庫切れに注意し、先回り提案が有効です。',
    tag:    'buy_loyal',
  },
  buy_trial: {
    style:  'お試し好き',
    advice: '小さい量・サンプルから入るタイプです。ミニサイズや1回分のお試しセットから提案しましょう。',
    tag:    'buy_trial',
  },
}

// ─── メイン生成関数 ───────────────────────────────────────────────────────────

/**
 * voice_notes の内容（transcript / summary / 既存タグ）から
 * InsightGeneratorResult を生成する。
 *
 * @param transcripts  各メモの文字起こし
 * @param summaries    各メモの要約（あれば）
 * @param existingTags 既存の insight_tags（voice_notes テーブルから）
 */
export function generateInsights(
  transcripts:  Array<string | null | undefined>,
  summaries?:   Array<string | null | undefined>,
  existingTags?: Array<string[] | null>,
): InsightGeneratorResult {

  // 全テキストをまとめて抽出
  const allTexts = [
    ...transcripts,
    ...(summaries ?? []),
  ]
  const { tags: extractedTags } = extractInsightTags(allTexts)

  // 既存タグとマージ（重複除去）
  const allTagSet = new Set<InsightTag>(extractedTags)
  if (existingTags) {
    for (const tagArr of existingTags) {
      if (!tagArr) continue
      for (const t of tagArr) allTagSet.add(t as InsightTag)
    }
  }
  const allTags = Array.from(allTagSet)

  // 次回提案
  const suggestions: NextServiceSuggestion[] = allTags
    .filter(t => t in SUGGESTION_MAP)
    .map(t => SUGGESTION_MAP[t])
    .filter((v): v is NextServiceSuggestion => v !== undefined)
    .sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 }
      return order[a.priority] - order[b.priority]
    })
    // 同じ治療が重複したら1件に絞る
    .filter((v, i, arr) => arr.findIndex(x => x.treatment === v.treatment) === i)
    .slice(0, 3)

  // NGワード
  const ngAlerts: NgWordAlert[] = allTags
    .filter(t => t in NG_MAP)
    .map(t => NG_MAP[t])
    .filter((v): v is NgWordAlert => v !== undefined)

  // 購入傾向
  const buyTendencies: PurchaseTendency[] = allTags
    .filter(t => t in BUY_MAP)
    .map(t => BUY_MAP[t])
    .filter((v): v is PurchaseTendency => v !== undefined)

  // 1行サマリー生成
  const parts: string[] = []
  if (suggestions.length > 0)    parts.push(`次回提案: ${suggestions[0].treatment}`)
  if (ngAlerts.length > 0)       parts.push(`注意: ${ngAlerts[0].topic}`)
  if (buyTendencies.length > 0)  parts.push(`購入傾向: ${buyTendencies[0].style}`)
  const summary = parts.length > 0 ? parts.join(' / ') : 'インサイトなし'

  return { suggestions, ngAlerts, buyTendencies, allTags, summary }
}

// ─── 顧客レベルで複数メモを集約する関数 ─────────────────────────────────────

export interface VoiceNoteInput {
  transcript?:   string | null
  summary?:      string | null
  insight_tags?: string[] | null
}

/**
 * 顧客の voice_notes 複数件から InsightGeneratorResult を生成する。
 * useCustomerStore や CustomerBottomSheet から呼び出す想定。
 */
export function generateInsightsFromNotes(
  notes: VoiceNoteInput[]
): InsightGeneratorResult {
  return generateInsights(
    notes.map(n => n.transcript),
    notes.map(n => n.summary),
    notes.map(n => n.insight_tags ?? null),
  )
}
