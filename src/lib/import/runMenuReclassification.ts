/**
 * runMenuReclassification.ts — brain_visits.menu_id 再解決(Pass L-2)
 *
 * source='salonboard_import' の既存来店データに対して、改善済み menuResolver
 * (keyword_match 追加)を再実行し、menu_id を更新する。
 *
 * 設計制約:
 *   - source='salonboard_import' の行のみ対象(リポジトリ層でもガード)
 *   - 更新するのは menu_id のみ(staff_id/amount/source 等は変更しない)
 *   - customer_type は変更しない(別途 /api/admin/customer-type/classify を実行)
 *   - fallback_other への再マッチは更新しない(改悪防止)
 *   - 同一 CSV を複数回投入しても冪等(変化なし行を noChange でカウント)
 */
import {
  parseSalonBoardDetailCsv,
  aggregateCheckouts,
} from './salonBoardDetailParser'
import { buildMenuLookup, resolveMenuId } from './menuResolver'
import { findNameCandidates } from './customerMatcher'
import type { ICustomerRepo, IVisitRepo, IMenuRepo } from '../../repositories/interfaces'
import type { UUID } from '../../types/riora.types'

export interface ReclassificationRepos {
  customerRepo: ICustomerRepo
  visitRepo:    IVisitRepo
  menuRepo:     IMenuRepo
}

export interface ReclassificationDetail {
  visitDate:    string
  customerName: string
  rawMenuName:  string
  beforeMenuId: string
  afterMenuId:  string
  method:       string
}

export interface ReclassificationReport {
  updated:   number
  noChange:  number
  skipped:   number
  errors:    number
  details:   ReclassificationDetail[]
}

function dateOnly(iso: string): string {
  return iso.slice(0, 10)
}

export async function runMenuReclassification(
  input: { storeId: UUID; csvText: string },
  repos: ReclassificationRepos,
): Promise<ReclassificationReport> {
  const parsed = parseSalonBoardDetailCsv(input.csvText)
  const { aggregates } = aggregateCheckouts(parsed.rows)

  const [menus, customers] = await Promise.all([
    repos.menuRepo.listByStore(input.storeId),
    repos.customerRepo.listByStore(input.storeId),
  ])

  const menuLookup = buildMenuLookup(menus)
  const fallbackMenuId = menuLookup.fallbackMenuId

  let updated = 0, noChange = 0, skipped = 0, errors = 0
  const details: ReclassificationDetail[] = []

  for (const agg of aggregates) {
    try {
      // 1. メニュー再解決
      const menuRes = resolveMenuId(agg.menuName, menuLookup)
      // fallback_other への「変更」は行わない（改悪防止）
      if (menuRes.status !== 'matched') {
        skipped++
        continue
      }

      // 2. 顧客照合: 既存 salonboard_import 来店を持つ候補を探す
      const nameCandidates = findNameCandidates(agg.customerName, customers)
      if (nameCandidates.length === 0) { skipped++; continue }

      const visitDate = dateOnly(agg.visitDateTime)

      // 候補の中から当該日付に salonboard_import 来店がある顧客を特定
      let matchedCustomerId: string | null = null
      for (const c of nameCandidates) {
        const v = await repos.visitRepo.findByCustomerAndDate(c.customerId, visitDate)
        if (v && v.source === 'salonboard_import') {
          matchedCustomerId = c.customerId
          break
        }
      }
      if (!matchedCustomerId) { skipped++; continue }

      // 3. 既存 visit 取得
      const existingVisit = await repos.visitRepo.findByCustomerAndDate(matchedCustomerId, visitDate)
      if (!existingVisit || existingVisit.source !== 'salonboard_import') { skipped++; continue }

      // 4. 変更不要チェック
      if (existingVisit.menuId === menuRes.menuId) { noChange++; continue }

      // 5. 変更前が fallback_other 以外なら skip（手動設定を上書きしない）
      if (existingVisit.menuId !== fallbackMenuId) { skipped++; continue }

      // 6. menu_id 更新（source='salonboard_import' ガードはリポジトリ層にもある）
      await repos.visitRepo.updateMenuId(existingVisit.id, menuRes.menuId)
      updated++
      details.push({
        visitDate,
        customerName: agg.customerName,
        rawMenuName:  agg.menuName,
        beforeMenuId: existingVisit.menuId,
        afterMenuId:  menuRes.menuId,
        method:       menuRes.method,
      })
    } catch (e) {
      errors++
    }
  }

  return { updated, noChange, skipped, errors, details }
}
