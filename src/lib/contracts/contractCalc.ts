/**
 * contractCalc.ts — 契約書・申込書の入力検証と金額計算(純粋関数。クライアント/サーバー共用)。
 *
 * 単価・コース名は必ずマスター(courseMaster.ts)から引く。クライアントが送った金額は信用しない。
 * 金額の手入力変更は不可: 金額 = 単価 × 数量、合計 = 全行の金額の和。
 * 未使用行(コース未選択で備考も空)は捨てる(PDFにも表示しない)。
 */
import { findContractCourse } from './courseMaster'
import {
  CONTRACT_ADDRESS_MAX_LENGTH, CONTRACT_MAX_LINES, CONTRACT_MAX_QUANTITY, CONTRACT_MIN_QUANTITY,
  CONTRACT_NAME_MAX_LENGTH, CONTRACT_NOTE_MAX_LENGTH, CONTRACT_PHONE_MAX_LENGTH,
  type ContractFormValues, type ContractLineInput, type ContractLineItem,
} from './contractTypes'

export type ContractErrorCode =
  | 'too_many_lines' | 'no_lines' | 'course_required' | 'unknown_course'
  | 'invalid_quantity' | 'note_too_long'
  | 'invalid_application_date' | 'name_required' | 'name_too_long' | 'address_required'
  | 'address_too_long' | 'phone_required' | 'phone_invalid'

export function calcLineAmount(unitPrice: number, quantity: number): number {
  return unitPrice * quantity
}

export function isValidQuantity(q: unknown): q is number {
  return typeof q === 'number' && Number.isInteger(q) && q >= CONTRACT_MIN_QUANTITY && q <= CONTRACT_MAX_QUANTITY
}

/** 制御文字・改行を落として前後の空白を削る(PDF/ハッシュの揺れ防止)。 */
export function normalizeText(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
}

export type BuildLinesResult =
  | { ok: true; items: ContractLineItem[]; total: number }
  | { ok: false; error: ContractErrorCode }

export function buildLineItems(
  documentType: ContractFormValues['documentType'],
  lines: ContractLineInput[],
): BuildLinesResult {
  if (lines.length > CONTRACT_MAX_LINES) return { ok: false, error: 'too_many_lines' }

  const items: ContractLineItem[] = []
  for (const line of lines) {
    const note = normalizeText(line.note ?? '')
    const unused = !line.courseId && note === ''
    if (unused) continue

    if (!line.courseId) return { ok: false, error: 'course_required' }
    const course = findContractCourse(documentType, line.courseId)
    if (!course) return { ok: false, error: 'unknown_course' }
    if (!isValidQuantity(line.quantity)) return { ok: false, error: 'invalid_quantity' }
    if (note.length > CONTRACT_NOTE_MAX_LENGTH) return { ok: false, error: 'note_too_long' }

    items.push({
      course_name: course.name,
      unit_price:  course.unitPrice,
      quantity:    line.quantity,
      amount:      calcLineAmount(course.unitPrice, line.quantity),
      note,
    })
  }

  if (items.length === 0) return { ok: false, error: 'no_lines' }
  return { ok: true, items, total: items.reduce((sum, i) => sum + i.amount, 0) }
}

export function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

export type ValidatedContract = {
  documentType:    ContractFormValues['documentType']
  applicationDate: string
  name:            string
  address:         string
  phoneNumber:     string
  items:           ContractLineItem[]
  total:           number
}

export type ValidateContractResult =
  | { ok: true; value: ValidatedContract }
  | { ok: false; error: ContractErrorCode }

/** 画面側の「次へ」可否とサーバー側の受理判定の両方で使う。 */
export function validateContractInput(v: ContractFormValues): ValidateContractResult {
  if (!isValidIsoDate(v.applicationDate)) return { ok: false, error: 'invalid_application_date' }

  const name = normalizeText(v.name ?? '')
  if (!name) return { ok: false, error: 'name_required' }
  if (name.length > CONTRACT_NAME_MAX_LENGTH) return { ok: false, error: 'name_too_long' }

  const address = normalizeText(v.address ?? '')
  if (!address) return { ok: false, error: 'address_required' }
  if (address.length > CONTRACT_ADDRESS_MAX_LENGTH) return { ok: false, error: 'address_too_long' }

  const phoneNumber = normalizeText(v.phoneNumber ?? '')
  if (!phoneNumber) return { ok: false, error: 'phone_required' }
  if (
    phoneNumber.length > CONTRACT_PHONE_MAX_LENGTH
    || !/^[0-9０-９+＋\-－ー()（）\s]+$/.test(phoneNumber)
    || !/[0-9０-９]/.test(phoneNumber)
  ) {
    return { ok: false, error: 'phone_invalid' }
  }

  const lines = buildLineItems(v.documentType, v.lines)
  if (!lines.ok) return lines

  return {
    ok: true,
    value: {
      documentType: v.documentType, applicationDate: v.applicationDate,
      name, address, phoneNumber, items: lines.items, total: lines.total,
    },
  }
}

export const CONTRACT_ERROR_MESSAGES: Record<ContractErrorCode, string> = {
  too_many_lines:           `コースは${CONTRACT_MAX_LINES}行までです`,
  no_lines:                 'コースを1つ以上選んでください',
  course_required:          '備考だけの行があります。コースを選ぶか、備考を消してください',
  unknown_course:           '選べないコースが含まれています',
  invalid_quantity:         `数量は${CONTRACT_MIN_QUANTITY}〜${CONTRACT_MAX_QUANTITY}で入力してください`,
  note_too_long:            `備考は${CONTRACT_NOTE_MAX_LENGTH}文字までです`,
  invalid_application_date: '申込日を選んでください',
  name_required:            '氏名を入力してください',
  name_too_long:            `氏名は${CONTRACT_NAME_MAX_LENGTH}文字までです`,
  address_required:         '住所を入力してください',
  address_too_long:         `住所は${CONTRACT_ADDRESS_MAX_LENGTH}文字までです`,
  phone_required:           '電話番号を入力してください',
  phone_invalid:            '電話番号は数字とハイフンで入力してください',
}
