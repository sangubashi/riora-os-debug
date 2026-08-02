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
 *
 * PHASE CSV-MENU-FALLBACK-IMPROVE(2026-08-02): CSV取込側がrole='imported_other'の行を
 * 未マッチ名ごとに複数作成するようになったため、「更新前がfallbackだったか」の判定を
 * 旧来のfallbackMenuId(店舗共有1行のID)単純比較から、imported_otherロールの全行ID
 * 集合(importedOtherIds)への包含チェックに変更した。旧来の共有1行のみに依存していると、
 * 新方式で作られた行に乗っている来店が再分類対象から漏れてしまうため。
 *
 * PHASE CSV-RECOVERY-1(2026-08-02): 過去にCSV取込(メニュー名未マッチ)へ集約された
 * 来店を、元のCSVメニュー名専用のimported_other行(PHASE CSV-MENU-FALLBACK-IMPROVEで
 * 導入)へ復元する機能を追加した。
 *   - デフォルト(recoverFallbackNames省略/false)では追加前と完全に同じ挙動
 *     (既存呼び出し元・/api/admin/visits/reclassify-menusの動作は無変更)。
 *   - recoverFallbackNames: true を指定すると、resolveMenuId()が'matched'を返さない
 *     行についても、既存visitが現在imported_other行に乗っている場合に限り復元対象にする。
 *   - dryRun(recoverFallbackNames時のデフォルトはtrue)がtrueの間はbrain_menus/
 *     brain_visitsへ一切書き込まず、previewFallbackMenu()で計算した結果のみを
 *     detailsとして返す(menu_id更新前に変更一覧を確認できるようにするため)。
 *     dryRun: false を明示した場合のみ、実際にresolveOrCreateFallbackMenu()で
 *     imported_other行を検索/新規作成し、menu_idを更新する。
 *   - treatment_amount=0の来店(店販・割引のみ等、実質メニューが無い会計)は
 *     復元対象から除外する(元々「メニュー」と呼べる実体が無いため)。
 *   - resolveMenuId()による既存の'matched'再分類ロジック(exact/normalized/partial/
 *     keyword_match)自体は変更していない。
 */
import {
  parseSalonBoardDetailCsv,
  aggregateCheckouts,
} from './salonBoardDetailParser'
import { buildMenuLookup, resolveMenuId, resolveOrCreateFallbackMenu, previewFallbackMenu } from './menuResolver'
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
  /** PHASE CSV-RECOVERY-1: 実際にDBへ書き込んだか。dry-run時はfalse(プレビューのみ)。 */
  applied:      boolean
}

export interface ReclassificationReport {
  updated:   number
  noChange:  number
  skipped:   number
  errors:    number
  details:   ReclassificationDetail[]
  /** PHASE CSV-RECOVERY-1: このレポートがdry-run(書き込みなし)結果かどうか。 */
  dryRun:    boolean
}

export interface RunMenuReclassificationInput {
  storeId: UUID
  csvText: string
  /**
   * PHASE CSV-RECOVERY-1: 未マッチ名(fallback_other/unresolved)の来店も、元のCSV
   * メニュー名専用のimported_other行への復元対象にする。省略時はfalse(既存挙動と
   * 完全に同じ。matched以外は従来どおりskip)。
   */
  recoverFallbackNames?: boolean
  /**
   * PHASE CSV-RECOVERY-1: trueの間はbrain_menus/brain_visitsへ一切書き込まず、
   * 変更されるであろう内容だけをreport.detailsで返す。recoverFallbackNames:true時の
   * デフォルトはtrue(まずdry-runのみ)。recoverFallbackNamesがfalse(既存の再分類のみ)
   * の場合は常にfalse相当(既存呼び出し元の挙動を変えないため、このフラグの影響を受けない)。
   */
  dryRun?: boolean
}

function dateOnly(iso: string): string {
  return iso.slice(0, 10)
}

export async function runMenuReclassification(
  input: RunMenuReclassificationInput,
  repos: ReclassificationRepos,
): Promise<ReclassificationReport> {
  const recoverFallbackNames = input.recoverFallbackNames ?? false
  // 既存の再分類のみ(recoverFallbackNames=false)の場合はdry-run概念自体が既存挙動に
  // 存在しなかったため、常に書き込む(=dryRun扱いにしない)。復元機能を使う場合のみ、
  // 明示的にdryRun:falseを指定しない限りdry-run(書き込みなし)にする。
  const dryRun = recoverFallbackNames ? (input.dryRun ?? true) : false

  const parsed = parseSalonBoardDetailCsv(input.csvText)
  const { aggregates } = aggregateCheckouts(parsed.rows)

  const [menus, customers] = await Promise.all([
    repos.menuRepo.listByStore(input.storeId),
    repos.customerRepo.listByStore(input.storeId),
  ])

  const menuLookup = buildMenuLookup(menus)
  // PHASE CSV-MENU-FALLBACK-IMPROVE: fallbackMenuId(店舗共有1行)だけでなく、未マッチ名
  // ごとに作られたimported_other行もすべて「フォールバック扱い」として拾う。
  const importedOtherIds = new Set(menus.filter(m => m.role === 'imported_other').map(m => m.id))

  let updated = 0, noChange = 0, skipped = 0, errors = 0
  const details: ReclassificationDetail[] = []

  for (const agg of aggregates) {
    try {
      // 1. メニュー再解決(既存4方式。変更なし)
      const menuRes = resolveMenuId(agg.menuName, menuLookup)

      // matched以外の行は、復元機能が無効ならここで早期skip(既存挙動と完全に同じ)。
      if (menuRes.status !== 'matched' && !recoverFallbackNames) {
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

      if (menuRes.status === 'matched') {
        // ── 既存の「本当に一致するメニューが見つかった」場合の再分類(挙動は無変更) ──
        if (existingVisit.menuId === menuRes.menuId) { noChange++; continue }
        // 変更前が fallback_other 以外なら skip（手動設定を上書きしない）
        if (!importedOtherIds.has(existingVisit.menuId)) { skipped++; continue }

        if (!dryRun) {
          await repos.visitRepo.updateMenuId(existingVisit.id, menuRes.menuId)
        }
        updated++
        details.push({
          visitDate,
          customerName: agg.customerName,
          rawMenuName:  agg.menuName,
          beforeMenuId: existingVisit.menuId,
          afterMenuId:  menuRes.menuId,
          method:       menuRes.method,
          applied:      !dryRun,
        })
        continue
      }

      // ── PHASE CSV-RECOVERY-1: 未マッチ名の復元(recoverFallbackNames:trueのみ到達) ──

      // 元々「メニュー」と呼べる実体が無い会計(店販・割引のみ等)は対象外。
      if (existingVisit.treatmentAmount === 0) { skipped++; continue }
      // 現在imported_other行に乗っていない(既に実メニューに手動設定済み等)来店は対象外。
      if (!importedOtherIds.has(existingVisit.menuId)) { skipped++; continue }

      if (dryRun) {
        const preview = previewFallbackMenu(agg.menuName, menuLookup)
        if (preview.menuId === null && !preview.wouldCreate) { skipped++; continue } // 空文字等、対象外
        if (preview.menuId === existingVisit.menuId) { noChange++; continue }
        details.push({
          visitDate,
          customerName: agg.customerName,
          rawMenuName:  agg.menuName,
          beforeMenuId: existingVisit.menuId,
          afterMenuId:  preview.menuId ?? '(新規作成予定)',
          method:       'fallback_other_recovered',
          applied:      false,
        })
        updated++
        continue
      }

      const recovered = await resolveOrCreateFallbackMenu(agg.menuName, menuLookup, input.storeId, repos.menuRepo)
      if (recovered.status !== 'fallback') { skipped++; continue } // 空文字等、対象外(matchedはこの分岐に来ない)
      if (recovered.menuId === existingVisit.menuId) { noChange++; continue }

      await repos.visitRepo.updateMenuId(existingVisit.id, recovered.menuId)
      updated++
      details.push({
        visitDate,
        customerName: agg.customerName,
        rawMenuName:  agg.menuName,
        beforeMenuId: existingVisit.menuId,
        afterMenuId:  recovered.menuId,
        method:       'fallback_other_recovered',
        applied:      true,
      })
    } catch (e) {
      errors++
    }
  }

  return { updated, noChange, skipped, errors, details, dryRun }
}
