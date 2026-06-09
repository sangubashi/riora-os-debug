/**
 * extractInsightTags.ts
 * Deterministic タグ抽出エンジン。
 *
 * transcript テキストからキーワードマッチングで InsightTag を抽出。
 * AI不使用。純粋関数。テスト容易。
 *
 * 将来の差し替えポイント:
 *   - Claude API / GPT-4o でのゼロショット分類
 *   - fine-tuned 分類モデル
 *
 * 設計方針:
 *   - 各タグに「陽性キーワード」を定義
 *   - transcript + summary + staffMemo の全テキストを対象
 *   - スコア閾値以上のタグを返す
 */

import type { InsightTag } from '@/types'

// ─── タグ → キーワードマッピング ─────────────────────────────────────────────

interface TagRule {
  keywords:    string[]   // いずれか1つにマッチすれば陽性
  minMatches:  number     // 最低マッチ数（デフォルト1）
}

const TAG_RULES: Record<InsightTag, TagRule> = {
  // ─── 肌悩み（既存） ─────────────────────────────────────────────────────────
  dryness_concern: {
    keywords:   ['乾燥', 'かさかさ', 'カサカサ', 'パサパサ', '潤い', 'うるおい', 'しっとり', 'ツッパリ', 'つっぱり'],
    minMatches: 1,
  },
  price_sensitive: {
    keywords:   ['値段', '価格', '高い', 'お高い', '予算', 'コスパ', 'コスト', '安く', 'もう少し安', '費用'],
    minMatches: 1,
  },
  event_before: {
    keywords:   ['結婚式', '披露宴', '同窓会', '記念日', 'デート', '発表会', '入学', '卒業', '就活', '面接', 'パーティー', 'イベント', '旅行前', '撮影'],
    minMatches: 1,
  },
  low_homecare: {
    keywords:   ['忘れる', 'さぼって', 'サボって', 'できてない', 'できていない', 'やってない', 'やっていない', 'ケアしてない', '洗顔だけ'],
    minMatches: 1,
  },
  high_motivation: {
    keywords:   ['頑張る', 'がんばる', '続ける', '続けたい', '定期的に', '毎月', '通いたい', 'また来たい', '楽しみ', '嬉しい', 'うれしい', 'モチベ'],
    minMatches: 1,
  },
  sensitive_skin: {
    keywords:   ['敏感', 'かぶれ', '荒れ', '反応', 'アレルギー', 'ヒリヒリ', 'ヒリつく', 'ピリピリ', '刺激'],
    minMatches: 1,
  },
  acne_concern: {
    keywords:   ['ニキビ', 'にきび', '吹き出物', '毛穴', 'ざらつき', 'ブツブツ', '詰まり'],
    minMatches: 1,
  },
  aging_concern: {
    keywords:   ['シワ', 'しわ', 'たるみ', 'ほうれい線', 'くすみ', '老け', 'エイジング', '年齢', 'ハリ', 'コラーゲン', '弾力'],
    minMatches: 1,
  },
  redness_concern: {
    keywords:   ['赤み', '赤い', '赤くなる', '炎症', 'テカリ', '紅潮', 'ほてり'],
    minMatches: 1,
  },
  busy_lifestyle: {
    keywords:   ['忙しい', 'いそがしい', '時間ない', '仕事', '育児', '子育て', '疲れ', 'バタバタ', '毎日', '朝早い', '夜遅い'],
    minMatches: 1,
  },
  // ─── 次回提案 ────────────────────────────────────────────────────────────────
  suggest_peel: {
    keywords:   ['ピーリング', 'ピール', '角質', 'くすみが気になる', 'くすみ取り', 'トーンアップ'],
    minMatches: 1,
  },
  suggest_whitening: {
    keywords:   ['美白', 'シミ', 'しみ', 'そばかす', 'ホワイトニング', '透明感', 'トーン'],
    minMatches: 1,
  },
  suggest_premium: {
    keywords:   ['プレミアム', '特別なケア', 'スペシャル', '上位', '贅沢', '本格的', '効果が出ない'],
    minMatches: 1,
  },
  suggest_homecare: {
    keywords:   ['家でも', '自宅でも', 'ホームケア', '日常的に', '毎日ケア', 'スキンケア見直し'],
    minMatches: 1,
  },
  suggest_rebook: {
    keywords:   ['また来ます', '次いつ', 'いつ来れば', '次回早め', 'すぐ予約', '続けたい', '定期的に来たい'],
    minMatches: 1,
  },
  // ─── NGワード ────────────────────────────────────────────────────────────────
  ng_price: {
    keywords:   ['他はもっと安', 'もっと安い', 'ちょっと高すぎ', '高すぎる', '予算オーバー', '払えない'],
    minMatches: 1,
  },
  ng_compare: {
    keywords:   ['他の店', '他店', '別のサロン', 'ライバル', '知人のサロン', '前のサロン', '前のお店'],
    minMatches: 1,
  },
  ng_time: {
    keywords:   ['急かされた', '急かす', '早く終わって', '時間かかりすぎ', '長すぎ', '押し売り', '勧めすぎ'],
    minMatches: 1,
  },
  // ─── 購入傾向 ────────────────────────────────────────────────────────────────
  buy_impulse: {
    keywords:   ['その場で', 'すぐ買う', '気に入ったら即', '衝動', 'その日に', 'もらいます', 'ください'],
    minMatches: 1,
  },
  buy_compare: {
    keywords:   ['考えてから', '一度持ち帰り', '夫に相談', '家族に相談', '調べてから', '比べてから', '検討します'],
    minMatches: 1,
  },
  buy_loyal: {
    keywords:   ['いつも同じ', 'これしか使わない', 'ずっと使ってる', 'リピート', 'お気に入り', 'もう何本も'],
    minMatches: 1,
  },
  buy_trial: {
    keywords:   ['試しに', 'まずは小さいの', 'サンプル', 'お試し', '一本だけ', '試してみたい'],
    minMatches: 1,
  },
}

// ─── 抽出ロジック ─────────────────────────────────────────────────────────────

export interface ExtractResult {
  tags:       InsightTag[]
  confidence: Partial<Record<InsightTag, number>>   // タグごとのマッチ数
}

/**
 * テキスト群からInsightTagを抽出する。
 * 複数テキストを結合してスキャンするため、漏れが少ない。
 */
export function extractInsightTags(texts: Array<string | null | undefined>): ExtractResult {
  // null/undefined を除外して結合（小文字化でマッチ率向上）
  const combined = texts
    .filter((t): t is string => typeof t === 'string' && t.length > 0)
    .join(' ')

  const tags:       InsightTag[]                            = []
  const confidence: Partial<Record<InsightTag, number>>     = {}

  for (const [tagKey, rule] of Object.entries(TAG_RULES) as [InsightTag, TagRule][]) {
    let matchCount = 0
    for (const kw of rule.keywords) {
      if (combined.includes(kw)) {
        matchCount++
      }
    }
    if (matchCount >= rule.minMatches) {
      tags.push(tagKey)
      confidence[tagKey] = matchCount
    }
  }

  // マッチ数降順でソート（強いシグナル優先）
  tags.sort((a, b) => (confidence[b] ?? 0) - (confidence[a] ?? 0))

  return { tags, confidence }
}

// ─── 顧客レベル集計 ──────────────────────────────────────────────────────────

export interface TagAggregate {
  tag:   InsightTag
  count: number
}

/**
 * 複数メモのタグ配列を集計し、出現頻度順で返す。
 */
export function aggregateInsightTags(
  notesTags: Array<string[] | null>
): TagAggregate[] {
  const counter: Partial<Record<InsightTag, number>> = {}

  for (const tags of notesTags) {
    if (!tags) continue
    for (const tag of tags) {
      const key = tag as InsightTag
      counter[key] = (counter[key] ?? 0) + 1
    }
  }

  return (Object.entries(counter) as [InsightTag, number][])
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
}
