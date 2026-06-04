/**
 * SalonBoardImportEngine.ts  — SalonBoard CSV 取込エンジン
 *
 * 処理フロー:
 *   CSV テキスト
 *     → parseSalonBoardCsv()        # PII除去 + 行パース
 *     → aggregateCustomers()         # 顧客単位に統合
 *     → enrichCustomers()            # Phase / Score 付与
 *     → SalonBoardImportResult       # 最終出力
 */

import type {
  SalonBoardRawRow,
  SalonBoardCustomer,
  SalonBoardImportResult,
  SalonBoardColumnMap,
  CustomerPhase,
} from '@/types'
import { parseSalonBoardCsv }   from './salonBoardParser'
import { calcCustomerPhase, calcCustomerScore } from '@/lib/phase5/customerRiskEngine'

// ─── 顧客名ハッシュ（照合キー）────────────────────────────────────────────────

/**
 * 顧客名を正規化してハッシュキーを生成。
 * 本番では Web Crypto API の SHA-256 を使用。
 * ここでは軽量な djb2 ハッシュを使用（Server/Client 両対応）。
 */
function nameToKey(name: string): string {
  const normalized = name.trim().replace(/\s+/g, '').replace(/　/g, '')
  let hash = 5381
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash) ^ normalized.charCodeAt(i)
    hash = hash & hash  // 32bit整数に収める
  }
  return `cust_${Math.abs(hash).toString(36)}`
}

/** 表示名: 苗字のみ抽出（スペースで区切れない場合は先頭3文字）*/
function toDisplayName(name: string): string {
  const parts = name.trim().split(/[\s　]+/)
  if (parts.length >= 2) return parts[0] + ' 様'
  return name.slice(0, 3) + '...'
}

// ─── 日付ユーティリティ ───────────────────────────────────────────────────────

function daysSince(dateStr: string): number {
  const d    = new Date(dateStr)
  const now  = new Date()
  return Math.floor((now.getTime() - d.getTime()) / 86400000)
}

// ─── 顧客統合 ─────────────────────────────────────────────────────────────────

function aggregateCustomers(
  rows: SalonBoardRawRow[]
): Map<string, SalonBoardCustomer> {
  const map = new Map<string, SalonBoardCustomer>()

  rows.forEach(row => {
    const key = nameToKey(row.customerName)

    if (!map.has(key)) {
      map.set(key, {
        nameHash:         key,
        displayName:      toDisplayName(row.customerName),
        ageGroup:         row.ageGroup,
        birthMonth:       row.birthMonth,
        visits:           0,
        totalSales:       0,
        retailSales:      0,
        avgSales:         0,
        lastVisitDate:    row.visitDate,
        treatments:       [],
        assignedStaff:    [],
        hasRecentPurchase: false,
        rebookCount:      0,
        designatedCount:  0,
        designationRate:  0,
        phase:            'new',
        score:            0,
      })
    }

    const c = map.get(key)!

    c.visits++
    c.totalSales    += row.sales
    c.retailSales   += row.retailSales
    if (row.retailSales > 0) c.hasRecentPurchase = true
    if (row.hasNextRebook)   c.rebookCount++
    if (row.isDesignated)    c.designatedCount++

    // 最終来店日を更新
    if (row.visitDate > c.lastVisitDate) c.lastVisitDate = row.visitDate

    // 施術・スタッフをユニーク追加
    if (row.treatment && !c.treatments.includes(row.treatment)) {
      c.treatments.push(row.treatment)
    }
    if (row.staffName && !c.assignedStaff.includes(row.staffName)) {
      c.assignedStaff.push(row.staffName)
    }

    // birthMonth / ageGroup は後勝ち
    if (row.birthMonth) c.birthMonth = row.birthMonth
    if (row.ageGroup)   c.ageGroup   = row.ageGroup
  })

  return map
}

// ─── Phase / Score 付与 ───────────────────────────────────────────────────────

function enrichCustomers(
  map: Map<string, SalonBoardCustomer>
): SalonBoardCustomer[] {
  return Array.from(map.values()).map(c => {
    c.avgSales        = c.visits > 0 ? Math.round(c.totalSales / c.visits) : 0
    c.designationRate = c.visits > 0 ? Math.round(c.designatedCount / c.visits * 100) : 0

    const days = daysSince(c.lastVisitDate)

    // calcCustomerPhase
    const phase: CustomerPhase = calcCustomerPhase({
      visits:               c.visits,
      totalSales:           c.totalSales,
      vipRank:              0,
      churnRisk:            Math.min(100, Math.round(days / 90 * 100)),
      daysSinceLastVisit:   days,
      recommendedCycleDays: 30,
    })

    // calcCustomerScore
    const scoreResult = calcCustomerScore({
      visits:           c.visits,
      totalSales:       c.totalSales,
      avgPrice:         c.avgSales,
      lineResponseRate: 50,  // CSV からは取れないため中間値
      vipRank:          0,
      churnRisk:        Math.min(100, Math.round(days / 90 * 100)),
    })

    return { ...c, phase, score: scoreResult.total }
  })
}

// ─── メインエンジン ───────────────────────────────────────────────────────────

export function runSalonBoardImport(
  csvText:           string,
  columnMapOverride?: SalonBoardColumnMap
): SalonBoardImportResult {

  // Step 1: CSV パース（PII除去済み）
  const { rows, totalLines, skippedRows, errors } =
    parseSalonBoardCsv(csvText, columnMapOverride)

  // Step 2: 顧客単位に統合
  const customerMap = aggregateCustomers(rows)

  // Step 3: Phase / Score 付与
  const customers   = enrichCustomers(customerMap)

  // 売上降順でソート
  customers.sort((a, b) => b.totalSales - a.totalSales)

  return {
    customers,
    totalRows:   totalLines,
    skippedRows: skippedRows + (totalLines - rows.length - skippedRows),
    errors,
    importedAt:  new Date().toISOString(),
  }
}

// ─── KPI 集計ヘルパー ─────────────────────────────────────────────────────────

export interface ImportKpiSummary {
  totalCustomers:   number
  totalSales:       number
  avgSalesPerCustomer: number
  vipCount:         number
  riskCount:        number
  rebookRate:       number    // 次回予約率 (0〜100)
  topTreatments:    string[]  // 売上上位3施術
  phaseBreakdown:   Record<CustomerPhase, number>
}

export function summarizeImport(
  result: SalonBoardImportResult
): ImportKpiSummary {
  const cs = result.customers
  if (cs.length === 0) {
    return {
      totalCustomers: 0, totalSales: 0, avgSalesPerCustomer: 0,
      vipCount: 0, riskCount: 0, rebookRate: 0, topTreatments: [],
      phaseBreakdown: { new:0, growing:0, repeat:0, vip:0, risk:0 },
    }
  }

  const totalSales = cs.reduce((s, c) => s + c.totalSales, 0)
  const totalVisits = cs.reduce((s, c) => s + c.visits, 0)
  const totalRebooks = cs.reduce((s, c) => s + c.rebookCount, 0)

  // フェーズ内訳
  const phaseBreakdown: Record<CustomerPhase, number> =
    { new:0, growing:0, repeat:0, vip:0, risk:0 }
  cs.forEach(c => { phaseBreakdown[c.phase]++ })

  // 施術ランキング（出現頻度）
  const treatMap = new Map<string, number>()
  cs.forEach(c => c.treatments.forEach(t => {
    treatMap.set(t, (treatMap.get(t) ?? 0) + 1)
  }))
  const topTreatments = Array.from(treatMap.entries())
    .sort((a,b) => b[1] - a[1])
    .slice(0, 3)
    .map(e => e[0])

  return {
    totalCustomers:      cs.length,
    totalSales,
    avgSalesPerCustomer: Math.round(totalSales / cs.length),
    vipCount:            phaseBreakdown.vip,
    riskCount:           phaseBreakdown.risk,
    rebookRate:          totalVisits > 0 ? Math.round(totalRebooks / totalVisits * 100) : 0,
    topTreatments,
    phaseBreakdown,
  }
}

// ─── 分析用データへの変換 ──────────────────────────────────────────────────────

import type { AnalyticsCustomerRow } from '@/lib/analytics/customerAnalytics'
import type { VipAnalyticsRow      } from '@/lib/analytics/vipAnalytics'
import type { TreatmentCustomerRow } from '@/lib/analytics/treatmentAnalytics'
import type { ProductCustomerRow   } from '@/lib/analytics/productAnalytics'

/** SalonBoardCustomer[] → AnalyticsCustomerRow[] */
export function toAnalyticsRows(
  customers: SalonBoardCustomer[]
): AnalyticsCustomerRow[] {
  return customers.map(c => ({
    id:               c.nameHash,
    visits:           c.visits,
    totalSales:       c.totalSales,
    avgPrice:         c.avgSales,
    lineResponseRate: 50,   // CSV未取得のため中間値
    vipRank:          c.phase === 'vip' ? 3 : 0,
    churnRisk:        c.phase === 'risk' ? 70 : 10,
    daysSinceLastVisit:   0,
    recommendedCycleDays: 30,
    hasRecentPurchase:    c.hasRecentPurchase,
  }))
}

/** SalonBoardCustomer[] → VipAnalyticsRow[] */
export function toVipRows(
  customers: SalonBoardCustomer[]
): VipAnalyticsRow[] {
  return customers.map(c => ({
    id:               c.nameHash,
    isVip:            c.phase === 'vip',
    visits:           c.visits,
    totalSales:       c.totalSales,
    lineResponseRate: 50,
    cycleDays:        30,
    hasRecentPurchase: c.hasRecentPurchase,
    treatments:       c.treatments,
    products:         [],   // CSV未取得
  }))
}

/** SalonBoardCustomer[] → TreatmentCustomerRow[] */
export function toTreatmentRows(
  customers: SalonBoardCustomer[]
): TreatmentCustomerRow[] {
  return customers.flatMap(c =>
    c.treatments.map(t => ({
      treatmentName:     t,
      totalSales:        c.totalSales,
      visitCount:        c.visits,
      hasRecentPurchase: c.hasRecentPurchase,
      hasNextRebook:     c.rebookCount > 0,
      churnRisk:         c.phase === 'risk' ? 70 : 15,
    }))
  )
}

/** SalonBoardCustomer[] → ProductCustomerRow[] */
export function toProductRows(
  customers: SalonBoardCustomer[]
): ProductCustomerRow[] {
  // CSV に商品情報がない場合は空配列を返す
  return customers
    .filter(c => c.retailSales > 0)
    .map(c => ({
      productName:    '店販商品',   // CSV では商品名未取得
      purchasePrice:  c.retailSales,
      isVip:          c.phase === 'vip',
      hasNextRebook:  c.rebookCount > 0,
      visitCount:     c.visits,
      churnRisk:      c.phase === 'risk' ? 70 : 15,
    }))
}
