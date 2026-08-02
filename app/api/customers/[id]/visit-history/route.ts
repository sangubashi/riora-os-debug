/**
 * GET /api/customers/[id]/visit-history — 顧客詳細「来店履歴」セクション (Phase UX-1)
 *
 * 認証: extractStaffFromRequest + canAccessCustomer (AUTH-2 準拠)
 *
 * データソース: brain_visits（+ brain_menus でメニュー名解決、brain_staff で担当者名解決）
 * 返却: { success, visits: [{ id, visitDate, menuName, menuId, amount, staffName }] }（visit_date DESC）
 * 金額(amount)は canAccessCustomer() を通過した担当者・共有客担当者・当日担当者・管理者にのみ返す
 * (AUTH-2a-rollback: 他スタッフの売上は見せない、自分/自分担当客の売上は見せる方針)。
 *
 * PHASE MENU-AI-3(2026-08-01): menuId(brain_visits.menu_id)を追加。CustomerBottomSheetが
 * line-message API呼び出し時にMenu AI Context(buildMenuAIContext参照)を組み立てる
 * ためのキーとして使う(内部的には既に取得済みの値をレスポンスに追加しただけで、
 * 新規クエリは発生していない)。
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '../../../../lib/repos'
import { idSchema, toValidationErrorResponse } from '../../../_schemas/common'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'

export interface VisitHistoryEntry {
  id:        string
  visitDate: string
  menuName:  string | null
  menuId:    string | null
  amount:    number
  staffName: string | null
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
    .select('id, visit_date, treatment_amount, retail_amount, menu_id, staff_id')
    .eq('customer_id', customerId)
    .is('deleted_at', null)
    .order('visit_date', { ascending: false })
    .limit(30)

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  const rows = (visits ?? []) as Array<{
    id: string; visit_date: string
    treatment_amount: number | null; retail_amount: number | null
    menu_id: string | null; staff_id: string | null
  }>

  const menuIds  = Array.from(new Set(rows.map(v => v.menu_id).filter((v): v is string => !!v)))
  const staffIds = Array.from(new Set(rows.map(v => v.staff_id).filter((v): v is string => !!v)))

  const [menusRes, staffRes] = await Promise.all([
    menuIds.length > 0
      ? supabase.from('brain_menus').select('id, name').in('id', menuIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
    staffIds.length > 0
      ? supabase.from('brain_staff').select('id, name').in('id', staffIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
  ])

  const menuMap  = new Map((menusRes.data ?? []).map(m => [m.id, m.name]))
  const staffMap = new Map((staffRes.data ?? []).map(s => [s.id, s.name]))

  const result: VisitHistoryEntry[] = rows.map(v => ({
    id:        v.id,
    visitDate: v.visit_date,
    menuName:  v.menu_id ? menuMap.get(v.menu_id) ?? null : null,
    menuId:    v.menu_id,
    amount:    (v.treatment_amount ?? 0) + (v.retail_amount ?? 0),
    staffName: v.staff_id ? staffMap.get(v.staff_id) ?? null : null,
  }))

  return NextResponse.json({ success: true, visits: result })
}
