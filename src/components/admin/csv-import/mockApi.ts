/**
 * mockApi.ts — CSV Import Management(画面⑥)の実API呼び出し
 *
 * 実APIエンドポイント対応(docs/architecture/Riora_Management_Dashboard_Architecture_v2.1.md §4):
 *   mockDryRun        → POST /api/admin/csv/dry-run
 *   mockRunImport     → POST /api/admin/csv/import
 *   mockFetchHistory  → GET  /api/admin/csv/history
 *   mockFetchStaffAliases / mockAddStaffAlias → GET/POST /api/admin/staff-aliases
 *
 * mockRunImportのみ、当初のUI先行実装(モック版)と signature が異なる:
 * 実装には「①で選択したCSVの原本」と「④の名寄せ決定」が必要なため、
 * file/reviewDecisionsを引数に追加した(ファイルはCsvImportScreen側でuseRefに保持)。
 * 進捗はサーバーが単一リクエスト/レスポンスのため擬似的なもの(開始時0%・完了時100%)。
 */
import { DEMO_STORE_ID } from '@/lib/constants'
import type {
  ImportHistoryItem,
  ImportReport,
  ReviewDecisionValue,
  StaffAlias,
  StaffAliasListResponse,
  ValidationResult,
} from './types'

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok || json['success'] === false) {
    throw new Error(String(json['message'] ?? json['error'] ?? `request_failed (${res.status})`))
  }
  return json
}

export async function mockDryRun(file: File): Promise<ValidationResult> {
  const form = new FormData()
  form.append('file', file)
  form.append('storeId', DEMO_STORE_ID)

  const res = await fetch('/api/admin/csv/dry-run', { method: 'POST', body: form })
  const { success, ...result } = await readJson(res)
  return result as unknown as ValidationResult
}

export async function mockRunImport(
  file: File,
  totalRows: number,
  reviewDecisions: Record<number, ReviewDecisionValue>,
  onProgress: (processedRows: number, totalRows: number) => void
): Promise<ImportReport> {
  onProgress(0, totalRows)

  const form = new FormData()
  form.append('file', file)
  form.append('storeId', DEMO_STORE_ID)
  form.append('reviewDecisions', JSON.stringify(reviewDecisions))

  const res = await fetch('/api/admin/csv/import', { method: 'POST', body: form })
  const { success, ...report } = await readJson(res)

  onProgress(totalRows, totalRows)
  return report as unknown as ImportReport
}

export async function mockFetchHistory(): Promise<ImportHistoryItem[]> {
  const res = await fetch(`/api/admin/csv/history?storeId=${DEMO_STORE_ID}`)
  const { history } = await readJson(res)
  return history as unknown as ImportHistoryItem[]
}

export async function mockFetchStaffAliases(): Promise<StaffAliasListResponse> {
  const res = await fetch(`/api/admin/staff-aliases?storeId=${DEMO_STORE_ID}`)
  const { success, ...response } = await readJson(res)
  return response as unknown as StaffAliasListResponse
}

export async function mockAddStaffAlias(alias: string, staffId: string): Promise<StaffAlias> {
  const res = await fetch('/api/admin/staff-aliases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ storeId: DEMO_STORE_ID, alias, staffId }),
  })
  const { success, ...created } = await readJson(res)
  return created as unknown as StaffAlias
}

export type StaffBindingDecision = { rawName: string; staffId: string }
export type ReviewDecisionMap = Record<number, ReviewDecisionValue>
