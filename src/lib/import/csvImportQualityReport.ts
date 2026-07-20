/**
 * csvImportQualityReport.ts — CSV Import品質レポート(Pass D)
 *
 * 既存csvQualityChecker.ts(salonBoardParser.ts「1行=1来店」旧フォーマット専用)とは別に、
 * 実フォーマット(SalonBoard売上明細・SalonBoardCheckoutAggregate[])向けに新設する。
 * Pass C(menuResolver名寄せ改善)・Pass D(顧客/スタッフ名寄せ精度検証)で判明した
 * 実データのリスクをDry Run/Import実行のいずれでも同じロジックで可視化する
 * (buildDryRunResult/runImportPipelineの両方から呼ぶ・決定論ルール・LLM不使用)。
 *
 * 設計判断: 同姓同名の重複検出(duplicateCustomerNames)は「自動マージしない」既存方針
 * (customerMatcher.ts参照)を変更するものではない。あくまで「会員番号が無いCSVでは
 * 同一人物が複数回来店すると既定値'new'で別人として複数顧客レコードが作られるリスクが
 * ある」ことを運用者に警告し、reviewDecisionsを明示的に検討してもらうための情報提供。
 */
import type { SalonBoardCheckoutAggregate } from './salonBoardDetailParser'
import { resolveMenuId, type MenuLookup, type MenuResolution } from './menuResolver'
import type { MenuResolutionLogEntry, MenuResolutionSummary, CsvQualityReport, CsvQualityWarning } from '../../components/admin/csv-import/types'

/**
 * menuResolver.resolveMenuId()の結果をrawMenuNameごとに集計する(Pass C: 名寄せ精度改善の
 * 追跡用)。CSV行ごとではなく一意なメニュー名ごとに集約することで、ログをコンパクトに保つ
 * (unresolvedStaffMapと同じ方針)。Dry Run/Import実行の両方から呼ぶ共通ロジック。
 */
export function recordMenuResolution(
  rawMenuName: string,
  resolution: MenuResolution,
  byRawName: Map<string, MenuResolutionLogEntry>
): void {
  const existing = byRawName.get(rawMenuName)
  if (existing) {
    existing.occurrenceCount += 1
    return
  }

  byRawName.set(rawMenuName, {
    rawMenuName,
    resolvedMenuId: resolution.status === 'unresolved' ? null : resolution.menuId,
    resolvedMenuName: resolution.status === 'unresolved' ? null : resolution.menuName,
    resolutionMethod: resolution.status === 'unresolved' ? 'unresolved' : resolution.method,
    occurrenceCount: 1,
  })
}

export function summarizeMenuResolution(byRawName: Map<string, MenuResolutionLogEntry>): MenuResolutionSummary {
  const entries = Array.from(byRawName.values())
  const summary: MenuResolutionSummary = {
    exactMatch: 0, normalizedMatch: 0, partialMatch: 0, fallbackOther: 0, unresolved: 0, entries,
  }
  for (const entry of entries) {
    switch (entry.resolutionMethod) {
      case 'exact_match':      summary.exactMatch += entry.occurrenceCount; break
      case 'normalized_match': summary.normalizedMatch += entry.occurrenceCount; break
      case 'partial_match':    summary.partialMatch += entry.occurrenceCount; break
      case 'fallback_other':   summary.fallbackOther += entry.occurrenceCount; break
      case 'unresolved':       summary.unresolved += entry.occurrenceCount; break
    }
  }
  return summary
}

export interface ComputeCsvQualityReportInput {
  aggregates: SalonBoardCheckoutAggregate[]
  menuLookup: MenuLookup
  unresolvedStaffCount: number
  needsReviewCount: number
  /** 会員番号(external_key_hash)による確定一致件数(customerResolutionRateの算出に使用)。 */
  hashMatchedCount: number
  /**
   * 氏名+来店日近傍ロジック(Pass A+C・重複生成停止フェーズ)による確定一致件数。
   * 会員番号が無いCSVで、氏名一致候補が複数件あってもPass N(単一候補フォールバック)が
   * 機能しないケースを補う。docs/DUPLICATE_PREVENTION_IMPLEMENTATION_PLAN.md準拠。
   */
  nameProximityMatchedCount: number
  /**
   * nameProximityMatchedCountのうち、複数候補タイブレーク(visit_proximity_closest)
   * 経由で確定した件数(docs/PASS_AC_FINAL_GO_NOGO_AUDIT.md §④監視項目対応)。
   * 実データ検証時点では0件だったため、本番初回運用での発動有無を確認する目的で分離集計する。
   */
  visitProximityClosestCount: number
  /**
   * Pass A+Cロジック(resolveByVisitProximity)が氏名一致候補を検討したが確定できず、
   * needs_review(自動統合しない)へ委ねた件数。同日衝突・複数候補の僅差・単一候補時の
   * C案ガード(visit実績3件未満+90日超)のいずれかに該当した行を含む
   * (docs/PASS_AC_GAP_GUARD_OPTIONS_AUDIT.md §4.3準拠)。
   */
  proximityReviewCount: number
  /** パース/会計集約段階のエラー件数(severity='error'・会計内不整合や必須列欠落等)。 */
  parseLevelErrorCount: number
  /** メニュー名がフォールバック行も無く未解決のままスキップされた件数。 */
  menuUnresolvedSkippedCount: number
}

/** DB/Supabaseに依存しない純粋関数。aggregateCheckouts()の結果から品質レポートを算出する。 */
export function computeCsvQualityReport(input: ComputeCsvQualityReportInput): CsvQualityReport {
  const {
    aggregates, menuLookup, unresolvedStaffCount, needsReviewCount,
    hashMatchedCount, nameProximityMatchedCount, visitProximityClosestCount, proximityReviewCount,
    parseLevelErrorCount, menuUnresolvedSkippedCount,
  } = input

  const menuResolutionByRawName = new Map<string, MenuResolutionLogEntry>()
  const nameOccurrences = new Map<string, number>()

  for (const agg of aggregates) {
    recordMenuResolution(agg.menuName, resolveMenuId(agg.menuName, menuLookup), menuResolutionByRawName)
    nameOccurrences.set(agg.customerName, (nameOccurrences.get(agg.customerName) ?? 0) + 1)
  }

  const menuResolution = summarizeMenuResolution(menuResolutionByRawName)
  const duplicateCustomerNames = Array.from(nameOccurrences.entries())
    .filter(([, count]) => count > 1)
    .map(([name, occurrenceCount]) => ({ name, occurrenceCount }))
    .sort((a, b) => b.occurrenceCount - a.occurrenceCount)

  const warnings: CsvQualityWarning[] = []
  let deduction = 0

  if (unresolvedStaffCount > 0) {
    deduction += Math.min(40, unresolvedStaffCount * 10)
    warnings.push({
      type: 'unresolved_staff',
      message: `スタッフ名が未解決の行が${unresolvedStaffCount}件あります。これらの行は来店データとして取り込まれません(brain_staff.name_aliasesへの紐付けが必要)`,
      count: unresolvedStaffCount,
      severity: 'error',
    })
  }

  if (duplicateCustomerNames.length > 0) {
    deduction += Math.min(20, duplicateCustomerNames.length * 5)
    const totalAffectedRows = duplicateCustomerNames.reduce((sum, d) => sum + d.occurrenceCount, 0)
    warnings.push({
      type: 'duplicate_customer_name',
      message: `同一氏名が複数回出現する顧客が${duplicateCustomerNames.length}名(${totalAffectedRows}行)います。会員番号が無いCSVでは「要確認」の判断を明示しない限り別人(新規顧客)として複数レコードが作られる可能性があります`,
      count: duplicateCustomerNames.length,
      severity: 'warn',
    })
  }

  if (needsReviewCount > 0) {
    deduction += Math.min(15, needsReviewCount * 3)
    warnings.push({
      type: 'needs_review_pending',
      message: `要確認(同姓同名候補)の行が${needsReviewCount}件あります。reviewDecisionsを指定しない場合は既定で新規顧客として作成されます`,
      count: needsReviewCount,
      severity: 'warn',
    })
  }

  const menuFallbackCount = menuResolution.fallbackOther + menuResolution.unresolved
  if (menuFallbackCount > 0) {
    deduction += Math.min(10, Math.round((menuFallbackCount / Math.max(1, aggregates.length)) * 10))
    warnings.push({
      type: 'menu_unmatched',
      message: `brain_menusと一致しないメニュー名が${menuFallbackCount}件あります(imported_otherへ集約)`,
      count: menuFallbackCount,
      severity: 'info',
    })
  }

  const score = Math.max(0, Math.min(100, 100 - deduction))
  const level: CsvQualityReport['level'] =
    score >= 90 ? 'excellent' :
    score >= 75 ? 'good' :
    score >= 55 ? 'fair' : 'poor'

  const total = aggregates.length
  const rate = (numerator: number): number => (total > 0 ? numerator / total : 0)

  return {
    score,
    level,
    totalCheckouts: total,
    warnings,
    menuResolution,
    duplicateCustomerNames,
    proximityMatchCount: nameProximityMatchedCount,
    proximityReviewCount,
    visitProximityClosestCount,
    rates: {
      customerResolutionRate: rate(hashMatchedCount),
      nameProximityResolutionRate: rate(nameProximityMatchedCount),
      combinedCustomerResolutionRate: rate(hashMatchedCount + nameProximityMatchedCount),
      staffResolutionRate: 1 - rate(unresolvedStaffCount),
      menuResolutionRate: 1 - rate(menuFallbackCount),
      importedOtherRate: rate(menuFallbackCount),
      errorCount: parseLevelErrorCount + menuUnresolvedSkippedCount,
      skippedCount: unresolvedStaffCount + menuUnresolvedSkippedCount + parseLevelErrorCount,
    },
  }
}
