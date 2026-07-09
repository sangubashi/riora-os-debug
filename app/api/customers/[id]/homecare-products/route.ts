/**
 * GET /api/customers/[id]/homecare-products — 顧客詳細「ホームケア使用商品」セクション (PHASE HC-2B)
 *
 * 認証: extractStaffFromRequest + canAccessCustomer (AUTH-2 準拠)
 *
 * データソース: brain_visits.retail_category（SalonBoard CSV取込時に "/" 区切りで
 * 保存された店販商品名。PHASE HC-2調査で実装済みと判明）+ brain_visits.visit_date。
 * 新規テーブル・migrationは使用しない（PHASE HC-2Bの制約）。
 *
 * 返却: { success, products: [{ productName, purchaseCount, lastPurchasedAt }] }
 *       lastPurchasedAt 降順
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '../../../../lib/repos'
import { idSchema, toValidationErrorResponse } from '../../../_schemas/common'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'

export interface HomecareProductEntry {
  productName:     string
  purchaseCount:   number
  lastPurchasedAt: string
}

/**
 * 商品名正規化（PHASE HC-2D）
 * - 先頭の「社販」プレフィックスを除去（例: 社販RIN モイスチャークリーム → RIN モイスチャークリーム）
 * - 「(※...)」「（※...）」形式の注記を除去（例: LebyRIN サンプル (※購入したものはカルテ記入) → LebyRIN サンプル）
 */
function normalizeProductName(raw: string): string {
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

  const stats = new Map<string, { purchaseCount: number; lastPurchasedAt: string }>()
  for (const row of rows) {
    if (!row.retail_category) continue
    const names = row.retail_category.split('/').map(n => normalizeProductName(n)).filter(Boolean)
    for (const name of names) {
      const ex = stats.get(name)
      if (ex) {
        ex.purchaseCount += 1
        if (row.visit_date > ex.lastPurchasedAt) ex.lastPurchasedAt = row.visit_date
      } else {
        stats.set(name, { purchaseCount: 1, lastPurchasedAt: row.visit_date })
      }
    }
  }

  const products: HomecareProductEntry[] = Array.from(stats.entries())
    .map(([productName, s]) => ({ productName, purchaseCount: s.purchaseCount, lastPurchasedAt: s.lastPurchasedAt }))
    .sort((a, b) => (a.lastPurchasedAt < b.lastPurchasedAt ? 1 : -1))

  return NextResponse.json({ success: true, products })
}
