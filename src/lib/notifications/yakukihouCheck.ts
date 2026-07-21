/**
 * yakukihouCheck.ts — 薬機法・NGワード簡易チェック(気遣いカード専用)
 *
 * Riora_アプリ内通知v1_祝福気遣いカード_設計書_v1.0.md §4「検査: 気遣いカード
 * のみ薬機法/NG語チェック(誕生日・記念日は祝福のみで検査不要)」・受入基準
 * 「気遣い参考文が薬機法検査を通る(効能断定なし)」に対応。
 *
 * リポジトリ内に類似の実装は無かった(調査済み)ため今回新規実装する。
 * キーワード照合のみの決定論チェック(LLM不使用)。誕生日・記念日カードには
 * 適用しない(設計書の明示的な区別に従う)。
 *
 * 【重要な限界】現状のホームケアカード(headline/suggestion)は固定テンプレート
 * 文字列であり、そもそもNGワードを含まない。本チェックは将来カードに
 * 顧客データ由来の自由記述(商品名等)が差し込まれる場合に備えた防御であり、
 * 現時点では常に safe=true を返す想定。
 */

// 化粧品等の景品表示法・薬機法で問題になりやすい効能断定・誇大表現の例。
// 完全な法務レビューの代替ではなく、簡易な機械的フィルタである点に留意。
const NG_WORDS = [
  '治る', '完治', '治療効果', '医療効果', '即効性', '必ず効く', '効果を保証',
  'シミが消える', 'シワが消える', '若返る', 'アンチエイジング効果を保証',
  '副作用なし', '100%効果', '劇的に改善', '永久に', '二度と',
]

export interface YakukihouCheckResult {
  safe:          boolean
  matchedWords:  string[]
}

/** テキストにNGワードが含まれないか判定する(純粋関数・決定論)。 */
export function checkYakukihouCompliance(text: string): YakukihouCheckResult {
  const matchedWords = NG_WORDS.filter((w) => text.includes(w))
  return { safe: matchedWords.length === 0, matchedWords }
}

/** NGワードを検出した場合、安全な定型文に差し替える(内容を書き換えず丸ごと置換。要約・言い換えはしない=LLM不使用の原則を維持)。 */
export function sanitizeForYakukihou(text: string, fallback: string): string {
  return checkYakukihouCompliance(text).safe ? text : fallback
}
