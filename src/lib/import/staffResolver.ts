/**
 * staffResolver.ts — brain_staff.name_aliases(JSONB) を利用した staff_id 解決
 *
 * 解決フロー(docs/architecture/Riora_Management_Dashboard_Architecture_v2.1.md §5):
 *   brain_staff.name または brain_staff.name_aliases[] のいずれかに正規化後一致 → 解決
 *   いずれも不一致 → 未解決
 *
 * brain_staffはインポート実行開始時に1回だけ全件取得し、本モジュールで
 * インメモリのMapに変換してから解決する(行ごとのDB問い合わせはしない)。
 */

import { normalizeStaffName } from './normalizer'

export interface StaffRow {
  id: string
  name: string
  nameAliases: string[]
}

export interface StaffLookup {
  byNormalizedName: Map<string, string>
}

export function buildStaffLookup(staff: StaffRow[]): StaffLookup {
  const byNormalizedName = new Map<string, string>()
  staff.forEach(s => {
    byNormalizedName.set(normalizeStaffName(s.name), s.id)
    s.nameAliases.forEach(alias => byNormalizedName.set(normalizeStaffName(alias), s.id))
  })
  return { byNormalizedName }
}

export type StaffResolution =
  | { status: 'resolved'; staffId: string; normalized: string }
  | { status: 'unresolved'; normalized: string }

export function resolveStaffId(raw: string, lookup: StaffLookup): StaffResolution {
  const normalized = normalizeStaffName(raw)
  const staffId = lookup.byNormalizedName.get(normalized)
  if (staffId) return { status: 'resolved', staffId, normalized }
  return { status: 'unresolved', normalized }
}
