/**
 * detectDuplicateGroups.ts — 重複顧客グループ検出(Duplicate Merge Queue Phase1)
 *
 * 設計根拠: docs/DUPLICATE_MERGE_QUEUE_DESIGN.md・docs/DUPLICATE_CUSTOMER_MERGE_STRATEGY.md
 *
 * brain_customers.name を toNameKey()(既存のCSV Import名寄せロジックと同一関数)で
 * グルーピングし、2件以上のグループを重複候補として検出する。DBへの永続化はしない
 * (都度計算するステートレス設計。CSV Importのduplicate_customer_name警告と同じ方針)。
 *
 * 区分(A/B/C)判定ロジックはdocs/DUPLICATE_CUSTOMER_MERGE_STRATEGY.md §2準拠:
 *   A: グループ内全員がvisit実績を持つ(パターンB。安全に自動統合可能)
 *   B: 一部のみvisit実績を持つ(パターンA。管理者確認が必要)
 *   C: 現状の検出ロジックでは判定不能(明確な別人根拠を持つケースは未検出のため
 *      実データでは出現しないが、将来の拡張に備えて型定義には残す)
 */
import { toNameKey } from '../import/normalizer'
import type {
  MergeGroupCategory, MergeGroupMemberSummary, MergeGroupSummary,
  MergeGroupDetail, MergeGroupContraindication,
} from '../../types/customerMerge'

export interface DuplicateDetectionCustomerInput {
  id: string
  name: string
  firstVisitDate: string | null
  createdAt: string
}

export interface DuplicateDetectionVisitInput {
  id: string
  customerId: string
  visitDate: string
  staffId: string | null
  visitCountAt: number
  treatmentAmount: number
  retailAmount: number
}

interface InternalGroup {
  key: string
  customers: DuplicateDetectionCustomerInput[]
}

function groupByNameKey(customers: DuplicateDetectionCustomerInput[]): InternalGroup[] {
  const byKey = new Map<string, DuplicateDetectionCustomerInput[]>()
  for (const c of customers) {
    const key = toNameKey(c.name)
    const list = byKey.get(key) ?? []
    list.push(c)
    byKey.set(key, list)
  }
  return Array.from(byKey.entries())
    .filter(([, list]) => list.length >= 2)
    .map(([key, list]) => ({ key, customers: list }))
}

export function classifyCategory(visitCounts: number[]): MergeGroupCategory {
  const withVisit = visitCounts.filter(n => n > 0).length
  if (withVisit === visitCounts.length) return 'A' // パターンB: 全員visit実績あり → 安全に自動統合可能
  if (withVisit > 0) return 'B' // パターンA: 一部のみvisit実績あり → 要確認
  return 'C' // 全員visit実績なし(理論上のみ。現状検出されない)
}

function selectRecommendedSurvivor(
  customers: DuplicateDetectionCustomerInput[],
  visitCountByCustomer: Map<string, number>
): string {
  const sorted = [...customers].sort((a, b) => {
    const va = visitCountByCustomer.get(a.id) ?? 0
    const vb = visitCountByCustomer.get(b.id) ?? 0
    if (vb !== va) return vb - va
    return a.createdAt.localeCompare(b.createdAt)
  })
  return sorted[0].id
}

export function detectDuplicateGroupSummaries(
  customers: DuplicateDetectionCustomerInput[],
  visits: DuplicateDetectionVisitInput[],
  staffNameById: Map<string, string>
): MergeGroupSummary[] {
  const visitsByCustomer = new Map<string, DuplicateDetectionVisitInput[]>()
  for (const v of visits) {
    const list = visitsByCustomer.get(v.customerId) ?? []
    list.push(v)
    visitsByCustomer.set(v.customerId, list)
  }

  const groups = groupByNameKey(customers)

  return groups.map(({ key, customers: members }) => {
    const visitCounts = members.map(m => (visitsByCustomer.get(m.id) ?? []).length)
    const category = classifyCategory(visitCounts)

    const allVisits = members.flatMap(m => visitsByCustomer.get(m.id) ?? [])
    const totalSales = allVisits.reduce((s, v) => s + v.treatmentAmount + v.retailAmount, 0)
    const lastVisitDate = allVisits.length > 0
      ? allVisits.map(v => v.visitDate).sort().at(-1) ?? null
      : null

    const rawNames = new Set(members.map(m => m.name))
    const hasNotationVariance = rawNames.size > 1

    // 代表氏名: 最も出現件数の多い表記(同数の場合は最初に現れたもの)。
    const nameOccurrence = new Map<string, number>()
    for (const m of members) nameOccurrence.set(m.name, (nameOccurrence.get(m.name) ?? 0) + 1)
    const displayName = Array.from(nameOccurrence.entries()).sort((a, b) => b[1] - a[1])[0][0]

    void staffNameById // 一覧では担当名までは出さない(詳細画面用に引数を揃えているだけ)

    return {
      groupKey: key,
      displayName,
      memberCount: members.length,
      category,
      totalVisitCount: allVisits.length,
      totalSales,
      lastVisitDate,
      hasNotationVariance,
    }
  }).sort((a, b) => b.memberCount - a.memberCount)
}

export function buildGroupDetail(
  groupKey: string,
  customers: DuplicateDetectionCustomerInput[],
  visits: DuplicateDetectionVisitInput[],
  staffNameById: Map<string, string>,
  contraindications: MergeGroupContraindication[]
): MergeGroupDetail | null {
  const members = customers.filter(c => toNameKey(c.name) === groupKey)
  if (members.length < 2) return null

  const visitsByCustomer = new Map<string, DuplicateDetectionVisitInput[]>()
  for (const v of visits) {
    if (!members.some(m => m.id === v.customerId)) continue
    const list = visitsByCustomer.get(v.customerId) ?? []
    list.push(v)
    visitsByCustomer.set(v.customerId, list)
  }

  const visitCountByCustomer = new Map<string, number>()
  for (const m of members) visitCountByCustomer.set(m.id, (visitsByCustomer.get(m.id) ?? []).length)

  const category = classifyCategory(members.map(m => visitCountByCustomer.get(m.id) ?? 0))
  const survivorId = selectRecommendedSurvivor(members, visitCountByCustomer)

  const memberSummaries: MergeGroupMemberSummary[] = members.map(m => {
    const memberVisits = visitsByCustomer.get(m.id) ?? []
    const sorted = [...memberVisits].sort((a, b) => a.visitDate.localeCompare(b.visitDate))
    const staffIds = Array.from(new Set(memberVisits.map(v => v.staffId).filter((s): s is string => s !== null)))
    return {
      customerId: m.id,
      name: m.name,
      visitCount: memberVisits.length,
      totalSales: memberVisits.reduce((s, v) => s + v.treatmentAmount + v.retailAmount, 0),
      firstVisitDate: sorted[0]?.visitDate ?? m.firstVisitDate,
      lastVisitDate: sorted.at(-1)?.visitDate ?? null,
      assignedStaffNames: staffIds.map(id => staffNameById.get(id) ?? id),
      createdAt: m.createdAt,
      recommendedSurvivor: m.id === survivorId,
    }
  })

  return {
    groupKey,
    category,
    members: memberSummaries,
    contraindications: contraindications.filter(c => members.some(m => m.id === c.customerId)),
    recommendedSurvivorId: survivorId,
  }
}
