/**
 * menuMasterConstants.ts — メニューマスタ管理画面のCRUDが共有する定数
 *
 * 監査指摘(#1/#2・PHASE MENU-UI-3.1)により、API(2ルート)とUIにそれぞれ
 * 重複定義されていたrole/target_typesの選択肢一覧をここへ一本化する。
 * 型はsrc/types/riora.types.tsのMenuRole/CustomerTypeを唯一の正とする。
 */
import { z } from 'zod'
import type { MenuRole, CustomerType } from '@/types/riora.types'

/** メニューマスタ管理画面で編集可能なrole('imported_other'はCSV突合エンジンの保護対象のため除く)。 */
export const EDITABLE_MENU_ROLES = ['entry', 'pore', 'sensitive', 'peeling', 'lifting'] as const satisfies readonly Exclude<MenuRole, 'imported_other'>[]

/** target_typesの全選択肢。 */
export const ALL_CUSTOMER_TYPES = ['A_acne', 'B_pore', 'C_sensitive', 'D_aging', 'E_bridal'] as const satisfies readonly CustomerType[]

/**
 * PHASE MENU-AI-1: create/update両ルートが共有するAI関連追加項目のzodスキーマ。
 * 現状Menu Master画面のUIに編集欄は無く(UI変更禁止)、API経由での値渡しのみに
 * 対応する。全てoptional(未指定なら該当列はSET対象外/INSERT時は列デフォルト)。
 * タグ配列は「短いタグのみ」を強制するため1件あたりの文字数に上限を設け、
 * 長文説明の混入(AIへ長文を渡さない方針との整合)を防ぐ。
 */
const AI_TAG_MAX_LENGTH = 20

const shortTagArray = z.array(z.string().min(1).max(AI_TAG_MAX_LENGTH)).optional()

export const menuAIFieldsSchema = z.object({
  durationMinutes: z.number().int().min(0).nullable().optional(),
  skinConcernTags: shortTagArray,
  expectedEffects: shortTagArray,
  recommendedCycleDays: z.number().int().min(0).nullable().optional(),
  contraindicationTags: shortTagArray,
  recommendedHomecareProducts: shortTagArray,
  aiTags: shortTagArray,
})
