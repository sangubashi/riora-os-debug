/**
 * knowledgeMatch.ts — brain_blog_articles（承認済み）とのタグ/カテゴリ一致による
 * AI提案・接客ヒント・LINEメッセージ生成の補強（PHASE2-C-2/C-3/C-4、設計根拠:
 * docs/KNOWLEDGE_AI_INTEGRATION_AUDIT_1.md、docs/KNOWLEDGE_TAG_STANDARD_AUDIT_1.md）。
 *
 * 記事のタイトル・本文・summary・URLはここでは一切扱わない。使うのは「keywords/categoryが
 * 一致したか」というシグナルのみで、実際に画面へ出す文言は本ファイルのSAFE_HINT_TEMPLATES
 * （固定テンプレート）、または一致したタグ名・カテゴリ名そのもの（buildMatchReasons）に限る。
 * LLM呼び出し・summaryの動的表示は一切行わない
 * （効果保証・残量推定・買い替え促進の文言も含めない。KNOWLEDGE_AI_INTEGRATION_AUDIT_1 6章準拠）。
 *
 * ブラウザ専用API(fetch/authedFetch)への依存を持たない純粋ロジックのみを置く
 * （サーバー側のAPI route（line-message等）からも直接importできるようにするため）。
 * 実際のAPI呼び出しは fetchKnowledgeMatch.ts（クライアント専用）に分離している。
 */
import { SKIN_TAG_LABELS } from '@/types'
import type { InsightTag } from '@/types'
import { getConversationHints } from '@/lib/homecare/homecareConversationHints'

// 肌悩み軸統一語彙15語のうち、insightTagsから追加で導出できるものの対応表
// (KNOWLEDGE_TAG_STANDARD_AUDIT_1 3-1節・4章の対応表に基づく)
const INSIGHT_TAG_TO_KEYWORDS: Partial<Record<InsightTag, string[]>> = {
  dryness_concern: ['乾燥'],
  sensitive_skin:  ['敏感'],
  acne_concern:    ['ニキビ'],
  aging_concern:   ['エイジング', 'くすみ', 'ハリ不足'],
  redness_concern: ['赤み'],
  busy_lifestyle:  ['忙しい'],
  price_sensitive: ['価格'],
  low_homecare:    ['継続'],
  high_motivation: ['継続'],
}

/** 顧客のskinTags/insightTagsから、brain_blog_articles.keywordsと突き合わせる候補語を作る。 */
export function buildCustomerTagVocabulary(
  skinTags: readonly string[],
  insightTags: readonly string[] = []
): string[] {
  const fromSkinTags = skinTags
    .map(t => SKIN_TAG_LABELS[t])
    .filter((v): v is string => Boolean(v))
  const fromInsightTags = insightTags.flatMap(t => INSIGHT_TAG_TO_KEYWORDS[t as InsightTag] ?? [])
  return Array.from(new Set([...fromSkinTags, ...fromInsightTags]))
}

/**
 * ホームケア購入商品名から、brain_blog_articles.categoryと突き合わせる候補語を作る。
 * 商品カテゴリ判定は既存のhomecareConversationHints.ts（PHASE HC-7）をそのまま流用する
 * (KNOWLEDGE_TAG_STANDARD_AUDIT_1 3-2節: category軸は既存の商品カテゴリ10種と同一語彙)。
 * 該当カテゴリが無い商品（'一般'）は候補に含めない。
 */
export function buildProductCategoryVocabulary(productNames: readonly string[]): string[] {
  const categories = productNames
    .map(name => getConversationHints(name).category)
    .filter(category => category !== '一般')
  return Array.from(new Set(categories))
}

// 許可される表現のみ（状態確認の疑問形。効果保証・残量推定・買い替え促進は一切含めない）
const SAFE_HINT_TEMPLATES: Record<string, string[]> = {
  '乾燥':     ['最近、乾燥や突っ張りは気になりますか？', '保湿は続けられていますか？'],
  '脂性':     ['皮脂やテカリが気になる時間帯はありますか？', 'さっぱりしたケアで満足されていますか？'],
  '敏感':     ['肌の調子で気になる変化はありますか？', '新しく試された化粧品などはありますか？'],
  'ニキビ':   ['最近の肌の調子はいかがですか？', 'お肌に気になる部分はありますか？'],
  'シミ':     ['紫外線対策は続けられていますか？', '気になる肌の変化はありますか？'],
  '赤み':     ['肌の赤みや火照りは落ち着いていますか？', '最近の肌の調子はいかがですか？'],
  '水分不足': ['お肌のうるおいは足りていますか？', '保湿ケアは続けられていますか？'],
  'エイジング': ['お肌のハリについて気になることはありますか？', '季節の変わり目でお肌の調子に変化はありましたか？'],
  '毛穴':     ['毛穴の目立ちが気になる時期はありますか？', '洗顔後のお肌の状態はいかがですか？'],
  'くすみ':   ['お肌の透明感について気になることはありますか？'],
  'ハリ不足': ['お肌のハリについて気になることはありますか？'],
  '摩擦':     ['お手入れの際、お肌への当たりは優しくできていますか？'],
  '忙しい':   ['最近お忙しい時期ではありませんか？', 'お手入れの時間は取れていますか？'],
  '価格':     ['続けやすい範囲でケアができていますか？'],
  '継続':     ['ケアは無理なく続けられていますか？', '習慣化はできていますか？'],
}

/** マッチする知識候補が無い場合の既定ヒント（従来の固定文言と同様の一般的な質問） */
export const GENERAL_HINTS: string[] = [
  'その後の肌の様子はいかがですか？',
  'ホームケアは続けられていますか？',
  '気になる点があれば伺いましょう',
]

/** 一致したキーワードから、画面表示用の安全な質問文を最大maxCount件選ぶ。一致が無ければGENERAL_HINTSを返す。 */
export function deriveHintsFromMatchedKeywords(matchedKeywords: string[], maxCount = 3): string[] {
  const hints: string[] = []
  for (const kw of matchedKeywords) {
    for (const hint of SAFE_HINT_TEMPLATES[kw] ?? []) {
      if (!hints.includes(hint)) hints.push(hint)
      if (hints.length >= maxCount) return hints
    }
  }
  return hints.length > 0 ? hints : GENERAL_HINTS
}

/**
 * 生成理由（PHASE2-C追加確認: 「AIの根拠を見せたい」要望への対応）。
 *
 * 【重要】ここで組み立てるのはタグ名・カテゴリ名そのもの、または固定の定型文のみ。
 * 記事タイトル・記事本文・summary・source_urlはこの関数の入力にも出力にも一切含まれない
 * （呼び出し側もそれらを渡してはならない）。
 *
 * 構造は{type, score, label, source}のオブジェクト配列とする（PHASE2-C追加確認2/3）。
 * score・sourceはいずれも内部利用のみ（将来、Riora Brain等がAIの根拠を説明する際に
 * 使う想定）で、画面には常にlabelのみを表示する。UIの見た目（・◯◯タグ一致 等）は
 * 従来通り変えない。sourceにも記事タイトル・本文・summary・URLは一切含めない
 * （テーブル名・一致した語そのものなど、それ単体では記事の内容を特定できない情報のみ）。
 */
export type MatchReasonType =
  | 'skin_tag_match'
  | 'category_match'
  | 'related_article_match'
  | 'homecare_product_match'
  | 'recent_visit_match'
  | 'purchase_history_match'

export interface MatchReason {
  type:  MatchReasonType
  /** 内部利用のみ。画面には表示しない（将来の重み付け・優先度計算用の固定値）。 */
  score: number
  /** 画面に表示する文言。タグ名・カテゴリ名・定型文のみ（記事タイトル等は含まない）。 */
  label: string
  /**
   * 内部利用のみ。画面には表示しない。根拠の出所（一致した語そのもの、またはデータソース名）。
   * 例: skin_tag_match→"乾燥"、category_match→"美容液系"、related_article_match→"brain_blog_articles"。
   */
  source?: string
}

// 内部利用のみの固定スコア。相対的な確度/強さの目安（現時点では単純な固定値表）。
const REASON_SCORE: Record<MatchReasonType, number> = {
  skin_tag_match:         30,
  category_match:         25,
  related_article_match:  20,
  homecare_product_match: 15,
  recent_visit_match:     15,
  purchase_history_match: 15,
}

export interface MatchReasonSignals {
  /** brain_blog_articles.keywordsと一致した肌タグ/AIタグ由来の語（例: ['乾燥','毛穴']） */
  matchedTagKeywords?:        string[]
  /** brain_blog_articles.categoryと一致したホームケア商品カテゴリ（例: ['美容液系']） */
  matchedCategories?:         string[]
  /** 商品名一致による関連記事(BLOG_CONTENT_PHASE2の仕組み)が見つかったか */
  hasRelatedArticleByProduct?: boolean
  /** ホームケア購入商品データがあるか */
  hasHomecareProduct?:        boolean
  /** 直近の来店・施術履歴データがあるか */
  hasRecentVisit?:            boolean
  /** 直近の購入履歴があるか */
  hasRecentPurchase?:         boolean
}

// 内部利用のみ。boolean系シグナルのsourceに使う固定のデータソース名(テーブル名相当)。
const REASON_SOURCE = {
  relatedArticleMatch:  'brain_blog_articles',
  homecareProductMatch: 'homecare_products',
  recentVisitMatch:     'brain_visits',
  purchaseHistoryMatch: 'customer_action_logs',
} as const

export function buildMatchReasons(signals: MatchReasonSignals): MatchReason[] {
  const reasons: MatchReason[] = []
  for (const tag of signals.matchedTagKeywords ?? []) {
    reasons.push({ type: 'skin_tag_match', score: REASON_SCORE.skin_tag_match, label: `${tag}タグ一致`, source: tag })
  }
  for (const cat of signals.matchedCategories ?? []) {
    reasons.push({ type: 'category_match', score: REASON_SCORE.category_match, label: `${cat}カテゴリ一致`, source: cat })
  }
  if (signals.hasRelatedArticleByProduct) {
    reasons.push({ type: 'related_article_match', score: REASON_SCORE.related_article_match, label: '関連記事一致', source: REASON_SOURCE.relatedArticleMatch })
  }
  if (signals.hasHomecareProduct) {
    reasons.push({ type: 'homecare_product_match', score: REASON_SCORE.homecare_product_match, label: 'ホームケア商品一致', source: REASON_SOURCE.homecareProductMatch })
  }
  if (signals.hasRecentVisit) {
    reasons.push({ type: 'recent_visit_match', score: REASON_SCORE.recent_visit_match, label: '前回施術一致', source: REASON_SOURCE.recentVisitMatch })
  }
  if (signals.hasRecentPurchase) {
    reasons.push({ type: 'purchase_history_match', score: REASON_SCORE.purchase_history_match, label: '購入履歴一致', source: REASON_SOURCE.purchaseHistoryMatch })
  }
  return reasons
}
