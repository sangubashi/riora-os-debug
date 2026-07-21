/**
 * productDurationEstimate.ts — ホームケア商品「使い切り日数」カテゴリ別暫定辞書
 *
 * Riora_アプリ内通知v1_祝福気遣いカード_設計書_v1.0.md §3-5(補充の頃 =
 * duration_daysの85〜90%地点)を実現するために必要な値だが、商品ごとの
 * 正確な使用日数を持つマスタテーブルは現行DBに存在しない
 * (brain_customer_productsは本番未適用、homecareUsageGuide.tsも頻度・
 * タイミングは持つが「何日で使い切るか」は持たない)。
 *
 * homecareUsageGuide.tsと同じ「暫定辞書」方式を踏襲し、商品名に含まれる
 * キーワードからカテゴリを推定する。DB・migrationは使用しない。
 *
 * 2026-07-19: 実際の商品情報に基づき日数を改訂(ローション30日/セラム30日/
 * クリーム30日/洗顔25〜30日/UV45日という実測値の提供を受け、以下の方針で反映):
 *   - 洗顔は「25〜30日」の幅の下限(25日)を採用(補充前通知は在庫切れの前に
 *     気づかせる目的のため、安全側=早めに倒す)
 *   - クレンジングは単独の情報提供が無かったため、性質が近い洗顔と同じ値を準用
 *   - エッセンスも単独の情報提供が無かったため、セラムと同じ美容液カテゴリとして
 *     セラムの値(30日)に揃える
 *   - UVは従来「クリーム」に巻き込まれていたが、独立カテゴリとして新設・分離
 *   - ミスト/アンプル・サプリは情報提供が無かったため現状維持
 * 判定順序が重要(先に一致したものを採用)。UVは「クリーム」より先に判定する
 * (「LedyRIN UVクリーム」等、両キーワードを含む商品名がクリーム扱いされないため)。
 *
 * 単発使用・都度提供の商品(シートマスク・サンプル・詰め合わせセット)は
 * 「使い切って補充する」という概念に馴染まないため対象外(null)とする。
 * キーワードに一致しない商品名も、不正確な推測をするより対象外とする方が
 * 誠実と判断し、対象外(null)を返す。
 *
 * 【重要な限界】この値は実測ではなく推定であり、実際の使用ペース・
 * 商品の内容量によって誤差がある。正確な運用には商品マスタ
 * (duration_days列)の新設が別途必要。
 */

interface DurationRule {
  keywords:      string[]
  durationDays:  number
  categoryLabel: string
}

// 判定順序が重要(先に一致したものを採用)。除外系(マスク/サンプル/セット)を最初に判定する。
const EXCLUDED_KEYWORDS = ['シートマスク', 'マスク', 'サンプル', 'セット']

const DURATION_RULES: DurationRule[] = [
  { keywords: ['UV'],                  durationDays: 45, categoryLabel: 'UV' },
  { keywords: ['クリーム'],           durationDays: 30, categoryLabel: 'クリーム' },
  { keywords: ['ローション'],         durationDays: 30, categoryLabel: '化粧水' },
  { keywords: ['クレンジング', '洗顔'], durationDays: 25, categoryLabel: '洗顔・クレンジング' },
  { keywords: ['セラム', 'エッセンス'], durationDays: 30, categoryLabel: '美容液' },
  { keywords: ['ミスト', 'アンプル'],  durationDays: 45, categoryLabel: 'ミスト・アンプル' },
  { keywords: ['サプリ'],             durationDays: 30, categoryLabel: 'サプリメント' },
]

export interface DurationEstimate {
  durationDays:  number
  categoryLabel: string
}

/** 商品名からカテゴリを推定し、使い切り目安日数を返す。推定できない場合はnull。 */
export function estimateProductDuration(productName: string): DurationEstimate | null {
  if (EXCLUDED_KEYWORDS.some((kw) => productName.includes(kw))) return null
  for (const rule of DURATION_RULES) {
    if (rule.keywords.some((kw) => productName.includes(kw))) {
      return { durationDays: rule.durationDays, categoryLabel: rule.categoryLabel }
    }
  }
  return null
}
