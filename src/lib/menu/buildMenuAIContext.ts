/**
 * buildMenuAIContext.ts — メニュー情報からAIへ渡してよい情報だけを組み立てる
 * (PHASE MENU-AI-1・純粋関数・DB非依存・LLM不使用)
 *
 * 設計方針(ユーザー指示2026-08-01・④AI Prompt整理): メニューの長文説明を
 * そのままLLMへ渡さない。AIへ渡す情報は下記6項目のみに限定する(許可リスト方式。
 * name/skinConcernTags/expectedEffects/recommendedHomecareProducts/生のprice等、
 * ここに無いものは一切含めない)。
 *
 *   ・ai_tags               → aiTags
 *   ・カテゴリ               → category(brain_menus.role)
 *   ・価格帯                 → priceBand({min,max}。生のprice円額はそのまま渡さない。
 *                             HomeCareGenerator(v2.0 §5)のHomeCarePlan.priceBandと
 *                             同じ{min,max}形状・5,000円刻みに揃えている)
 *   ・施術時間               → durationMinutes
 *   ・禁忌                   → contraindicationTags(メニュー共通の禁忌タグのみ。
 *                             顧客個別のcontraindicationsテーブルとは別)
 *   ・おすすめ頻度            → recommendedCycleDays
 *
 * Customer Bottom Sheet / AI提案(NextAction) / LINE AI / 音声メモ / ホームケア提案
 * のいずれかがメニューIDからAIコンテキストを組み立てたくなった場合、
 * menuRepo.findById(menuId) で取得した Menu をこの関数に渡すだけでよい。
 *
 * PHASE MENU-AI-3(2026-08-01): AI提案(generateCustomerProposal.ts)・LINE AI
 * (line-message route)・ホームケアAI(homecare-message route)がこの関数を
 * 実際に利用する。既存プロンプトの文章は書き換えず、末尾に
 * formatMenuAIContextBlock()が生成する「Menu AI Context」ブロックを追記するだけ
 * (新しい指示文はAIへ渡さない)。
 */
import type { Menu, MenuRole } from '@/types/riora.types'

const PRICE_BAND_SIZE = 5000

export interface MenuAIContext {
  aiTags: string[]
  category: MenuRole
  priceBand: { min: number; max: number }
  durationMinutes: number | null
  contraindicationTags: string[]
  recommendedCycleDays: number | null
}

/** priceを5,000円刻みの{min,max}帯に丸める(生の価格そのものはAIへ渡さない)。 */
export function toPriceBand(price: number): { min: number; max: number } {
  const min = Math.floor(price / PRICE_BAND_SIZE) * PRICE_BAND_SIZE
  return { min, max: min + PRICE_BAND_SIZE }
}

/** MenuからAIへ渡してよい情報だけを抽出する(許可リスト方式)。 */
export function buildMenuAIContext(menu: Menu): MenuAIContext {
  return {
    aiTags: menu.aiTags ?? [],
    category: menu.role,
    priceBand: toPriceBand(menu.price),
    durationMinutes: menu.durationMinutes ?? null,
    contraindicationTags: menu.contraindicationTags ?? [],
    recommendedCycleDays: menu.recommendedCycleDays ?? null,
  }
}

/**
 * MenuAIContextをLLMプロンプトに追記できるテキストブロックへ整形する
 * (PHASE MENU-AI-3)。値が無い項目(空配列・null)の行は出さない
 * (架空の「未設定」等の穴埋め文言を作らない)。①②③すべてこの1つの関数を
 * 共有し、フォーマットのブレを作らない。
 */
export function formatMenuAIContextBlock(context: MenuAIContext): string {
  const lines = ['Menu AI Context', `- category: ${context.category}`]
  if (context.aiTags.length > 0) {
    lines.push(`- aiTags: ${context.aiTags.join('・')}`)
  }
  if (context.durationMinutes !== null) {
    lines.push(`- durationMinutes: ${context.durationMinutes}分`)
  }
  if (context.recommendedCycleDays !== null) {
    lines.push(`- recommendedCycleDays: ${context.recommendedCycleDays}日`)
  }
  if (context.contraindicationTags.length > 0) {
    lines.push(`- contraindicationTags: ${context.contraindicationTags.join('・')}`)
  }
  lines.push(`- priceBand: ¥${context.priceBand.min.toLocaleString('ja-JP')}〜¥${context.priceBand.max.toLocaleString('ja-JP')}`)
  return lines.join('\n')
}
