/**
 * contractsApiClient.ts — 契約書・申込書API(/api/customers/[id]/contracts)のクライアント。
 * 認証は authedFetch に委譲(既存APIと同じ Authorization: Bearer)。
 */
import { authedFetch } from '@/lib/api/authedFetch'
import type { ContractDocumentType, ContractFormValues } from './contractTypes'
import type { ContractErrorCode } from './contractCalc'

export interface ContractSummary {
  id:              string
  documentType:    ContractDocumentType
  /** YYYY-MM-DD */
  applicationDate: string
  totalAmount:     number
  createdAt:       string
  pdfUrl:          string | null
  /** 保存時のcontent_hashと再計算結果が一致するか(一覧取得時のみ。保存直後はtrue扱い)。 */
  integrityOk?:    boolean
}

export class ContractApiError extends Error {
  constructor(public readonly code: string, public readonly validationCode?: ContractErrorCode) {
    super(code)
  }
}

export async function listContracts(customerId: string): Promise<ContractSummary[]> {
  const res = await authedFetch(`/api/customers/${customerId}/contracts`)
  if (!res.ok) throw new ContractApiError(`list_failed:${res.status}`)
  const body = await res.json() as { success: boolean; contracts?: ContractSummary[] }
  if (!body.success || !body.contracts) throw new ContractApiError('list_failed')
  return body.contracts
}

export async function createContract(
  customerId: string,
  values: ContractFormValues,
  signature: Blob,
  staffId?: string | null,
): Promise<ContractSummary> {
  const fd = new FormData()
  fd.set('payload', JSON.stringify({
    documentType: values.documentType, applicationDate: values.applicationDate, name: values.name,
    address: values.address, phoneNumber: values.phoneNumber, lines: values.lines,
    ...(staffId ? { staffId } : {}),
  }))
  fd.set('signature', signature, 'signature.png')

  const res = await authedFetch(`/api/customers/${customerId}/contracts`, { method: 'POST', body: fd })
  const body = await res.json().catch(() => null) as
    { success?: boolean; contract?: ContractSummary; error?: string; code?: ContractErrorCode } | null
  if (res.ok && body?.success && body.contract) return { ...body.contract, integrityOk: true }
  throw new ContractApiError(body?.error ?? `create_failed:${res.status}`, body?.code)
}
