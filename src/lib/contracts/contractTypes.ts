/**
 * contractTypes.ts — 契約書・申込書(/karte)の型と定数(2026-10-02)。
 *
 * 対象は /karte(カルテアプリ)のみ。Riora OS側のbrain_menus等には一切依存しない。
 */

export const CONTRACT_DOCUMENT_TYPES = ['subscription', 'ticket'] as const
export type ContractDocumentType = (typeof CONTRACT_DOCUMENT_TYPES)[number]

export function isContractDocumentType(v: unknown): v is ContractDocumentType {
  return typeof v === 'string' && (CONTRACT_DOCUMENT_TYPES as readonly string[]).includes(v)
}

/** 契約書専用Storageバケット(customer-photosとは分離。PDF/署名PNGのみ許可、非公開)。 */
export const CONTRACT_BUCKET = 'customer-contracts'

/** 入力行は最大4行、数量は1〜99。 */
export const CONTRACT_MAX_LINES = 4
export const CONTRACT_MIN_QUANTITY = 1
export const CONTRACT_MAX_QUANTITY = 99

export const CONTRACT_NOTE_MAX_LENGTH = 40
export const CONTRACT_NAME_MAX_LENGTH = 50
export const CONTRACT_ADDRESS_MAX_LENGTH = 200
export const CONTRACT_PHONE_MAX_LENGTH = 20

/** 署名PNGの上限(1MB)。 */
export const CONTRACT_SIGNATURE_MAX_BYTES = 1024 * 1024

/** 文書レイアウト/文言のバージョン(content_hashに含め、将来の変更と区別できるようにする)。2: 事業者情報を更新、3: 事業者住所に部屋番号(401)を追加、4: 見本レイアウトへ変更(単価列を廃止・空行4つ・合計を表内・事業者枠と署名枠)(2026-10-02)。 */
export const CONTRACT_TEMPLATE_VERSION = 4

/** 保存時点のスナップショット(将来マスター価格が変わっても過去の契約書の内容は変わらない)。 */
export interface ContractLineItem {
  course_name: string
  unit_price:  number
  quantity:    number
  amount:      number
  note:        string
}

/** 画面/APIから渡される入力行(単価・金額はサーバーがマスターから再計算する)。 */
export interface ContractLineInput {
  courseId: string | null
  quantity: number | null
  note:     string
}

export interface ContractFormValues {
  documentType:    ContractDocumentType
  /** YYYY-MM-DD */
  applicationDate: string
  name:            string
  address:         string
  phoneNumber:     string
  lines:           ContractLineInput[]
}
