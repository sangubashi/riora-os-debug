/**
 * GET /api/customers/[id]/celebration-cards — 祝福・気遣いカード(v1・読み取り専用)
 *
 * Riora_アプリ内通知v1_祝福気遣いカード_設計書_v1.0.md §3。AI Timeline内に
 * 表示するカードのデータ。既存テーブルのみ使用、新規テーブル・migrationなし。
 * 対象は誕生日・結婚式・ホームケア継続中の3種(通知一覧と同じ検出ロジックを
 * 再利用し、カード化対象のみ抽出する)。
 *
 * 認証: extractStaffFromRequest + canAccessCustomer (AUTH-2準拠)
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '../../../../lib/repos'
import { idSchema, toValidationErrorResponse } from '../../../_schemas/common'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'
import { normalizeProductName } from '../homecare-products/route'
import { detectNotificationsForCustomer, type NotificationCustomerInput } from '@/lib/notifications/detectNotifications'
import { generateCelebrationCards, selectMemorySoft, type MemoryCandidate } from '@/lib/notifications/generateCard'

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

  try {
    const supabase = getServiceClient()

    const { data: customer, error: customerError } = await supabase
      .from('brain_customers')
      .select('id, name, wedding_date, first_visit_date')
      .eq('id', customerId)
      .is('deleted_at', null)
      .maybeSingle()

    if (customerError) {
      return NextResponse.json({ success: false, error: customerError.message }, { status: 500 })
    }
    if (!customer) {
      return NextResponse.json({ success: true, cards: [] })
    }

    const [visitsRes, memoriesRes, skinRes, reservationsRes] = await Promise.all([
      supabase
        .from('brain_visits')
        .select('visit_date, retail_category')
        .eq('customer_id', customerId)
        .is('deleted_at', null)
        .order('visit_date', { ascending: true }),
      // memory_soft(誕生日カード パターンB)の選定にも使うため、memory_typeを
      // 'anniversary'に絞らず全件取得する(誕生日検出用の絞り込みはコード側で行う)。
      supabase
        .from('customer_memories')
        .select('memory_type, trigger_date, content, is_sensitive, created_at')
        .eq('customer_id', customerId),
      supabase
        .from('brain_skin_records')
        .select('primary_delta, created_at')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: true }),
      supabase
        .from('reservations')
        .select('scheduled_at')
        .eq('brain_customer_id', customerId),
    ])

    if (visitsRes.error) return NextResponse.json({ success: false, error: visitsRes.error.message }, { status: 500 })
    if (memoriesRes.error) return NextResponse.json({ success: false, error: memoriesRes.error.message }, { status: 500 })
    if (skinRes.error) return NextResponse.json({ success: false, error: skinRes.error.message }, { status: 500 })
    if (reservationsRes.error) return NextResponse.json({ success: false, error: reservationsRes.error.message }, { status: 500 })

    type VisitRow = { visit_date: string; retail_category: string | null }
    const visits = (visitsRes.data ?? []) as VisitRow[]

    let lastVisitDate: string | null = null
    const productCounts = new Map<string, { count: number; lastPurchasedAt: string }>()
    const nearbyVisitDates: string[] = []
    for (const v of visits) {
      lastVisitDate = v.visit_date // 昇順取得なので最後の代入が最新
      nearbyVisitDates.push(v.visit_date)
      if (!v.retail_category) continue
      const names = v.retail_category.split('/').map((n) => normalizeProductName(n)).filter(Boolean)
      for (const name of names) {
        const ex = productCounts.get(name)
        if (ex) {
          ex.count += 1
          if (v.visit_date > ex.lastPurchasedAt) ex.lastPurchasedAt = v.visit_date
        } else {
          productCounts.set(name, { count: 1, lastPurchasedAt: v.visit_date })
        }
      }
    }
    type ReservationRow = { scheduled_at: string }
    for (const r of (reservationsRes.data ?? []) as ReservationRow[]) {
      nearbyVisitDates.push(r.scheduled_at)
    }

    type MemoryRow = { memory_type: string; trigger_date: string | null; content: string; is_sensitive: boolean; created_at: string }
    const memories = (memoriesRes.data ?? []) as MemoryRow[]

    type SkinRow = { primary_delta: number | null; created_at: string }
    const skinDeltas = ((skinRes.data ?? []) as SkinRow[])
      .map((s) => s.primary_delta)
      .filter((d): d is number => d !== null)

    const input: NotificationCustomerInput = {
      id: customer.id,
      name: customer.name,
      weddingDate: customer.wedding_date,
      firstVisitDate: customer.first_visit_date,
      lastVisitDate,
      memories: memories
        .filter((m) => m.memory_type === 'anniversary' && m.trigger_date !== null)
        .map((m) => ({
          memoryType: m.memory_type,
          triggerDate: m.trigger_date,
          content: m.content,
        })),
      retailProductCounts: productCounts,
      skinPrimaryDeltas: skinDeltas,
      nearbyVisitDates,
    }

    const notifications = detectNotificationsForCustomer(input)

    const memoryCandidates: MemoryCandidate[] = memories.map((m) => ({
      memoryType: m.memory_type,
      content: m.content,
      isSensitive: m.is_sensitive,
      createdAt: m.created_at,
    }))
    const memorySoft = selectMemorySoft(memoryCandidates)

    const cards = generateCelebrationCards(notifications, memorySoft)

    return NextResponse.json({ success: true, cards })
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
