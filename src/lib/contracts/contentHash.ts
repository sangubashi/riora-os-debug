/**
 * contentHash.ts — 契約内容の改ざん確認用ハッシュ(サーバー専用、SHA-256)。
 *
 * 保存時にline_items・申込内容・署名画像のハッシュ等から content_hash を作って保存する。
 * 後から行を読み出して同じ関数で再計算し、一致すれば保存時から内容が変わっていないと確認できる。
 * キー順に依らない正規化(canonicalJson)を使う。
 */
import { createHash } from 'node:crypto'
import { CONTRACT_TEMPLATE_VERSION, type ContractDocumentType, type ContractLineItem } from './contractTypes'

export interface ContractHashSource {
  documentType:     ContractDocumentType
  applicationDate:  string
  name:             string
  address:          string
  phoneNumber:      string
  lineItems:        ContractLineItem[]
  totalAmount:      number
  signatureSha256:  string
  templateVersion?: number
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const obj = value as Record<string, unknown>
  return `{${Object.keys(obj).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`
}

export function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex')
}

export function computeContentHash(src: ContractHashSource): string {
  return sha256Hex(canonicalJson({
    v:               src.templateVersion ?? CONTRACT_TEMPLATE_VERSION,
    documentType:    src.documentType,
    applicationDate: src.applicationDate,
    name:            src.name,
    address:         src.address,
    phoneNumber:     src.phoneNumber,
    lineItems:       src.lineItems.map(i => ({
      course_name: i.course_name, unit_price: i.unit_price, quantity: i.quantity, amount: i.amount, note: i.note,
    })),
    totalAmount:     src.totalAmount,
    signatureSha256: src.signatureSha256,
  }))
}
