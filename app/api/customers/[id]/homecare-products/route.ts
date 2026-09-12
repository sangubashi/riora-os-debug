/**
 * GET /api/customers/[id]/homecare-products — 顧客詳細「ホームケア使用商品」セクション (PHASE HC-2B)
 *
 * 認証: extractStaffFromRequest + canAccessCustomer (AUTH-2 準拠)
 *
 * データソース: brain_visits.retail_category（SalonBoard CSV取込時に "/" 区切りで
 * 保存された店販商品名。PHASE HC-2調査で実装済みと判明）+ brain_visits.visit_date。
 *
 * 2026-09-12(顧客ステータス機能・PHASE RETAIL-ITEMS-1): totalAmount/averageIntervalDaysを
 * 追加した。averageIntervalDaysはretail_category由来の購入日群だけで計算できるため
 * 新規テーブル不要(既存データでも即座に計算できる)。totalAmountはbrain_visit_retail_items
 * (商品単位の金額を保持する新テーブル)からのSUMのため、CSV再取込(遡及移行)が済んでいない
 * 過去分はnullのまま(未計算)を返す。既存のproductName/purchaseCount/lastPurchasedAtの
 * 算出ロジック自体は無変更。
 *
 * 返却: { success, products: [{ productName, purchaseCount, lastPurchasedAt,
 *         totalAmount, averageIntervalDays }] } lastPurchasedAt 降順
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '../../../../lib/repos'
import { idSchema, toValidationErrorResponse } from '../../../_schemas/common'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'

export interface HomecareProductEntry {
  productName:         string
  purchaseCount:        number
  lastPurchasedAt:       string
  /** brain_visit_retail_itemsからのSUM(amount)。遡及移行が済んでいない商品はnull。 */
  totalAmount:           number | null
  /** 購入日群の間隔の中央値(日数)。購入が1回のみの場合はnull。 */
  averageIntervalDays:   number | null
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid]
}

/** "YYYY-MM-DD"同士の日数差(UTC基準)。 */
function daysBetween(fromStr: string, toStr: string): number {
  const from = Date.parse(`${fromStr}T00:00:00Z`)
  const to = Date.parse(`${toStr}T00:00:00Z`)
  return Math.round((to - from) / 86_400_000)
}

/** 購入日配列(順不同)から間隔の中央値を計算する。2件未満はnull。 */
function computeAverageIntervalDays(visitDates: string[]): number | null {
  if (visitDates.length < 2) return null
  const sorted = [...visitDates].sort()
  const gaps: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    gaps.push(daysBetween(sorted[i - 1], sorted[i]))
  }
  return median(gaps)
}

/**
 * 商品名正規化（PHASE HC-2D）
 * - 先頭の「社販」プレフィックスを除去（例: 社販RIN モイスチャークリーム → RIN モイスチャークリーム）
 * - 「(※...)」「（※...）」形式の注記を除去（例: LebyRIN サンプル (※購入したものはカルテ記入) → LebyRIN サンプル）
 */
export function normalizeProductName(raw: string): string {
  return raw
    .replace(/^社販/, '')
    .replace(/[（(]※[^）)]*[）)]/g, '')
    .trim()
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const staff = await extractStaffFromRequest(req)
  if (!staff) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const idResult = idSchema.safeParse(id)
  if (!idResult.success) {
    return NextResponse.json(toValidationErrorResponse(idResult.error), { status: 400 })
  }
  const customerId = idResult.data

  const accessible = await canAccessCustomer(staff.staffBrainId, customerId, staff.isAdmin)
  if (!accessible) {
    return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 })
  }

  const supabase = getServiceClient()

  const { data: visits, error } = await supabase
    .from('brain_visits')
    .select('visit_date, retail_category')
    .eq('customer_id', customerId)
    .is('deleted_at', null)
    .not('retail_category', 'is', null)
    .order('visit_date', { ascending: false })

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  const rows = (visits ?? []) as Array<{ visit_date: string; retail_category: string | null }>

  const stats = new Map<string, { purchaseCount: number; lastPurchasedAt: string; visitDates: string[] }>()
  for (const row of rows) {
    if (!row.retail_category) continue
    const names = row.retail_category.split('/').map(n => normalizeProductName(n)).filter(Boolean)
    for (const name of names) {
      const ex = stats.get(name)
      if (ex) {
        ex.purchaseCount += 1
        ex.visitDates.push(row.visit_date)
        if (row.visit_date > ex.lastPurchasedAt) ex.lastPurchasedAt = row.visit_date
      } else {
        stats.set(name, { purchaseCount: 1, lastPurchasedAt: row.visit_date, visitDates: [row.visit_date] })
      }
    }
  }

  // 顧客ステータス機能(PHASE RETAIL-ITEMS-1): brain_visit_retail_itemsから商品ごとの
  // 累計金額を取得する。visit_idからcustomer_idを辿る必要があるため、まず対象顧客の
  // visit_id一覧を取得してからIN句で絞り込む(brain_visit_retail_items自体は
  // customer_idを持たない設計のため)。
  const { data: customerVisits } = await supabase
    .from('brain_visits')
    .select('id')
    .eq('customer_id', customerId)
    .is('deleted_at', null)
  const visitIds = (customerVisits ?? []).map(v => (v as { id: string }).id)

  const totalAmountByProduct = new Map<string, number>()
  if (visitIds.length > 0) {
    const { data: retailItems } = await supabase
      .from('brain_visit_retail_items')
      .select('product_name, amount')
      .in('visit_id', visitIds)

    for (const item of (retailItems ?? []) as Array<{ product_name: string; amount: number | null }>) {
      if (item.amount === null) continue
      const name = normalizeProductName(item.product_name)
      totalAmountByProduct.set(name, (totalAmountByProduct.get(name) ?? 0) + item.amount)
    }
  }

  const products: HomecareProductEntry[] = Array.from(stats.entries())
    .map(([productName, s]) => ({
      productName,
      purchaseCount:       s.purchaseCount,
      lastPurchasedAt:     s.lastPurchasedAt,
      totalAmount:         totalAmountByProduct.get(productName) ?? null,
      averageIntervalDays: computeAverageIntervalDays(s.visitDates),
    }))
    .sort((a, b) => (a.lastPurchasedAt < b.lastPurchasedAt ? 1 : -1))

  return NextResponse.json({ success: true, products })
}
