/**
 * customerMatcher.ts — SalonBoard明細1件 → brain_customers突合方針の決定
 *
 * 設計根拠: docs/architecture/CSVImportSecurityArchitecture.md §3-3
 *   1. external_key_hash完全一致 → 既存顧客に確定マッチ
 *   2. 会員番号無し(またはハッシュ不一致) → 氏名一致候補をneeds_reviewとして提示
 *      (運用者の確認待ち・自動マージしない)
 *   3. 候補無し → 新規顧客
 *
 * 売上明細CSVの1行(=1会計)には他顧客の氏名・生年月日等の比較材料が無いため、
 * needs_reviewの絞り込みはtoNameKey()完全一致のみで行う(過剰な自動判定をしない・
 * 最終判断は運用者に委ねる方針)。
 */

import { toNameKey } from './normalizer'
import type { Customer } from '../../types/riora.types'

export interface CustomerCandidate {
  customerId: string
  displayLabel: string
}

/** 氏名キー一致する既存顧客を名寄せ候補として返す(DB問い合わせはしない・呼び出し側がlistByStoreで取得済みの一覧を渡す)。 */
export function findNameCandidates(customerName: string, existingCustomers: Customer[]): CustomerCandidate[] {
  const key = toNameKey(customerName)
  return existingCustomers
    .filter(c => toNameKey(c.name) === key)
    .map(c => ({
      customerId: c.id,
      displayLabel: `${c.name}(既存・${c.firstVisitDate ?? '初回来店日不明'})`,
    }))
}

export type CustomerMatchDecision =
  | { status: 'matched'; customerId: string }
  | { status: 'needs_review'; candidates: CustomerCandidate[] }
  | { status: 'new' }

export function decideCustomerMatch(input: {
  matchedByHash: Customer | null
  nameCandidates: CustomerCandidate[]
}): CustomerMatchDecision {
  if (input.matchedByHash) {
    return { status: 'matched', customerId: input.matchedByHash.id }
  }
  if (input.nameCandidates.length > 0) {
    return { status: 'needs_review', candidates: input.nameCandidates }
  }
  return { status: 'new' }
}
