/**
 * PUT /api/customers/[id]/today-treatment-course — 「今回の施術」保存(現場優先版)
 *
 * 背景(2026-09-28ユーザー承認・追加調査): brain_visitsは実際には翌日以降SalonBoard CSV
 * インポートで一括作成されており(source='salonboard_import')、来店当日には
 * visit_date=今日のvisit行がほぼ存在しない(スマホアプリの「接客ログ保存」
 * (/api/visits/service-complete)を当日中に使った場合のみ例外)。/karte単独で使う限り
 * このためcourse_options/option_itemsを保存する対象visitが存在せず、「今回の施術」が常に
 * 保存不可能だった。「事前予約CSVよりも現場の入力が正である」という方針(ユーザー承認)
 * のもと、本日分のvisitが無ければこのAPI自身がその場で作成する。
 *
 * 作成パターンはservice-complete/route.tsと同じ「findByCustomerAndDate→無ければ
 * createSequenced()(source既定値'staff_input')」を再利用する(csvImportPipeline.ts・
 * VisitRepo.reconcile()には一切触れない)。翌日以降のSalonBoard CSVインポートは、
 * csvImportPipeline.ts側が元々持つfindByCustomerAndDate+reconcile()の突合ロジック
 * (customer_id+visit_dateキー、主にsource='staff_input'の行を対象)により、この場で
 * 作成したstaff_input行を自動的に見つけてstaffId/menuId/金額等を正しい値へ上書き
 * 更新する(既存ロジック無変更・重複作成されないことをコード上で確認済み)。
 *
 * menuIdは必須列(NOT NULL)だが、この画面ではメニュー選択を行わないため、顧客の直近
 * 来店のmenu_idを暫定値として使う(無ければ同店舗の任意のメニュー1件)。翌日のCSV取込
 * reconcile()が正しい値へ上書きするため、暫定値の選び方自体は最終的な集計に影響しない。
 *
 * courseOptions/optionItems(2026-09-28ユーザー承認): 「今回の施術」を「メインコース」
 * (course_options、固定14項目)と「追加オプション」(option_items、固定26項目・4カテゴリ)
 * に構造化し、それぞれ独立して選択・保存できるようにした。どちらか一方のみのPUTも許可し、
 * 未指定側の列は更新しない(相手の選択内容を上書きしない)。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getRepos, getServiceClient } from '../../../../lib/repos'
import { idSchema, toValidationErrorResponse } from '../../../_schemas/common'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'

const putBodySchema = z.object({
  courseOptions: z.array(z.string()).max(14).optional(),
  optionItems:   z.array(z.string()).max(26).optional(),
}).refine(
  (b) => b.courseOptions !== undefined || b.optionItems !== undefined,
  { message: 'at least one of courseOptions/optionItems is required' },
)

/** service-complete/route.tsのtodayDateOnly()と同一(UTC基準、既知のJST 0-9時ズレも同様に踏襲)。 */
function todayDateOnly(): string {
  return new Date().toISOString().slice(0, 10)
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const staff = await extractStaffFromRequest(req)
  if (!staff?.staffBrainId) {
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

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 })
  }
  const parsed = putBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(toValidationErrorResponse(parsed.error), { status: 400 })
  }
  const { courseOptions, optionItems } = parsed.data

  const repos = getRepos()
  const customer = await repos.customerRepo.findById(customerId)
  if (!customer) {
    return NextResponse.json({ success: false, error: 'customer_not_found' }, { status: 404 })
  }

  const visitDate = todayDateOnly()
  let visitId: string

  const existing = await repos.visitRepo.findByCustomerAndDate(customerId, visitDate)
  if (existing) {
    visitId = existing.id
  } else {
    const supabase = getServiceClient()

    // 暫定menu_id: 直近来店のmenu_idを流用(無ければ同店舗の任意メニュー1件)。
    const { data: lastVisit } = await supabase
      .from('brain_visits')
      .select('menu_id')
      .eq('customer_id', customerId)
      .is('deleted_at', null)
      .not('menu_id', 'is', null)
      .order('visit_date', { ascending: false })
      .limit(1)
      .maybeSingle()

    let fallbackMenuId = (lastVisit as { menu_id: string | null } | null)?.menu_id ?? null
    if (!fallbackMenuId) {
      const { data: anyMenu } = await supabase
        .from('brain_menus')
        .select('id')
        .eq('store_id', customer.storeId)
        .limit(1)
        .maybeSingle()
      fallbackMenuId = (anyMenu as { id: string } | null)?.id ?? null
    }
    if (!fallbackMenuId) {
      return NextResponse.json({ success: false, error: 'no_menu_available' }, { status: 500 })
    }

    try {
      const created = await repos.visitRepo.createSequenced({
        storeId:           customer.storeId,
        customerId,
        staffId:           staff.staffBrainId,
        menuId:            fallbackMenuId,
        visitDate,
        isNomination:      false,
        treatmentAmount:   0,
        retailAmount:      0,
        retailCategory:    null,
        homecarePurchased: false,
        homecareDeclined:  false,
        nextBookingMade:   false,
        noBookingReason:   null,
        voiceMemoUrl:      null,
        visitScore:        0,
      })
      visitId = created.id
    } catch (e) {
      return NextResponse.json({ success: false, error: e instanceof Error ? e.message : 'visit_create_failed' }, { status: 500 })
    }
  }

  const update: Record<string, unknown> = {}
  if (courseOptions !== undefined) update.course_options = courseOptions
  if (optionItems   !== undefined) update.option_items   = optionItems

  const supabase = getServiceClient()
  const { data: updated, error } = await supabase
    .from('brain_visits')
    .update(update)
    .eq('id', visitId)
    .select('id, course_options, option_items')
    .maybeSingle()

  if (error || !updated) {
    return NextResponse.json({ success: false, error: error?.message ?? 'update_failed' }, { status: 500 })
  }

  return NextResponse.json({
    success:       true,
    visitId:       (updated as { id: string }).id,
    courseOptions: (updated as { course_options: unknown }).course_options,
    optionItems:   (updated as { option_items: unknown }).option_items,
  })
}
