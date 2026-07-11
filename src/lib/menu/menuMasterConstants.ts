/**
 * menuMasterConstants.ts — メニューマスタ管理画面のCRUDが共有する定数
 *
 * 監査指摘(#1/#2・PHASE MENU-UI-3.1)により、API(2ルート)とUIにそれぞれ
 * 重複定義されていたrole/target_typesの選択肢一覧をここへ一本化する。
 * 型はsrc/types/riora.types.tsのMenuRole/CustomerTypeを唯一の正とする。
 */
import type { MenuRole, CustomerType } from '@/types/riora.types'

/** メニューマスタ管理画面で編集可能なrole('imported_other'はCSV突合エンジンの保護対象のため除く)。 */
export const EDITABLE_MENU_ROLES = ['entry', 'pore', 'sensitive', 'peeling', 'lifting'] as const satisfies readonly Exclude<MenuRole, 'imported_other'>[]

/** target_typesの全選択肢。 */
export const ALL_CUSTOMER_TYPES = ['A_acne', 'B_pore', 'C_sensitive', 'D_aging', 'E_bridal'] as const satisfies readonly CustomerType[]
