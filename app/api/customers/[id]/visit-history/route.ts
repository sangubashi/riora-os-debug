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
 *
 * PHASE MENU-DISPLAY-NAME-1(2026-09-20ユーザー承認): menuNameはbrain_menus.nameでは
 * なく`official_display_name ?? name`を返す。official_display_nameは表示専用の
 * 正式名称(ホットペッパービューティー掲載クーポン名等)で、CSV取込のメニュー名突合
 * (menuResolver.ts)が参照するnameとは独立した列のため、この変更は取込ロジックに
 * 一切影響しない。呼び出し元(ipadKarteData.ts・customerModeData.ts、IpadStaffKarteView.tsx・
 * CustomerModeView.tsxの「今回の施術」「来店履歴」)はmenuNameをそのまま表示するだけなので
 * 無変更で反映される。
 *
 * courseOptions(2026-09-29ユーザー承認・来店履歴カードのヘッダー見出し反映バグ修正):
 * brain_visits.course_options(「✏️ メインコース」で手動設定される値、PATCH
 * /visits/[visitId]/treatment経由)を追加で返す。VisitHistorySection.tsxの
 * ヘッダー見出しが従来menuName(予約/CSV由来)しか見ておらず、手動でコースを変更しても
 * 見出しに反映されなかったバグの修正に使う。同一クエリの列追加のみで新規JOIN・
 * 追加リクエストは発生しない。
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '../../../../lib/repos'
import { idSchema, toValidationErrorResponse } from '../../../_schemas/common'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'

export interface VisitHistoryEntry {
  id:            string
  visitDate:     string
  menuName:      string | null
  menuId:        string | null
  amount:        number
  staffName:     string | null
  /** 「✏️ メインコース」で手動設定された値(未設定時は空配列)。 */
  courseOptions: string[]
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string')
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
    .select('id, visit_date, treatment_amount, retail_amount, menu_id, staff_id, course_options')
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
    course_options: unknown
  }>

  const menuIds  = Array.from(new Set(rows.map(v => v.menu_id).filter((v): v is string => !!v)))
  const staffIds = Array.from(new Set(rows.map(v => v.staff_id).filter((v): v is string => !!v)))

  const [menusRes, staffRes] = await Promise.all([
    menuIds.length > 0
      ? supabase.from('brain_menus').select('id, name, official_display_name').in('id', menuIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string; official_display_name: string | null }> }),
    staffIds.length > 0
      ? supabase.from('brain_staff').select('id, name').in('id', staffIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
  ])

  const menuMap  = new Map((menusRes.data ?? []).map(m => [m.id, m.official_display_name ?? m.name]))
  const staffMap = new Map((staffRes.data ?? []).map(s => [s.id, s.name]))

  const result: VisitHistoryEntry[] = rows.map(v => ({
    id:            v.id,
    visitDate:     v.visit_date,
    menuName:      v.menu_id ? menuMap.get(v.menu_id) ?? null : null,
    menuId:        v.menu_id,
    amount:        (v.treatment_amount ?? 0) + (v.retail_amount ?? 0),
    staffName:     v.staff_id ? staffMap.get(v.staff_id) ?? null : null,
    courseOptions: toStringList(v.course_options),
  }))

  return NextResponse.json({ success: true, visits: result })
}
