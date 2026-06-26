/**
 * HomeCareGenerator.ts — ホームケア提案カテゴリ注記の生成(決定論・LLM不使用)
 *
 * 設計根拠: docs/ai/Riora_Proposal_Generator_Architecture_v2.0.md §5
 *   (⑥HomeCareGenerator: カテゴリのみ提案・1点限定・価格帯±50%)
 *
 * **本Stepでの誠実なスコープ縮小**: brain_*には実在のホームケア商品カタログ
 * (商品名・価格)テーブルが存在しない(調査済み・`customers.last_product_purchase`は
 * 旧customersテーブルの付帯カラムでbrain_*とは別スキーマ)。架空の商品名・価格を
 * 作ることは禁止のため、本実装は`brain_pattern_steps.label`(実データ・パターン
 * マスタに登録された施術者向けラベル)からカテゴリ注記のみを生成する
 * (商品名・価格の提示は将来、実商品カタログが整備された時点で実装する)。
 */
import type { Candidate } from '../../types/riora.types';

export function generateHomeCareNote(candidate: Candidate): string | null {
  if (candidate.proposalKind !== 'homecare') return null;
  return `ホームケア提案(カテゴリ参考: ${candidate.code})。商品の重ね提案は1点までとし、価格帯は通常の客単価から大きく外れないものを選んでください。`;
}
