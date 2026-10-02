/**
 * POST /api/reservations/[id]/reschedule — 「別日に予約」(/karte、2026-10-02)
 *
 * body: { date: 'YYYY-MM-DD', time: 'HH:mm'(JST), allowOverlap?: boolean, brainCustomerId?: string }
 *
 * カルテアプリ(Riora OS DB)を正として、予約を別の日時へ移す。サロンボード側へは反映されない。
 *   1. 元の予約と同じ顧客・担当・メニュー・所要時間で、新しい日時の予約を作成する(status='confirmed')
 *   2. 元の予約を「変更」にする(status='cancelled', cancelled_at=now, cancel_source='manual')
 * 元の予約は削除しない。cancel_source='manual'のため、サロンボードCSVを再取込しても
 * 元の日時の予約が復活しない(reservationImportPipeline.tsの手動キャンセル保護)。新しい日時の予約は
 * CSVに存在しないため、再取込で上書き・削除されない。
 *
 * 2つの書き込みは別々のため、1→2の順に行い、2が失敗した場合は1で作った予約を削除して元に戻す
 * (予約が二重に残らない/消えない)。元の予約の状態は更新時にstatus='confirmed'を条件に含め、
 * 二重送信・他端末での操作済みは409にする。
 *
 * 認証・権限は cancel/route.ts と同じ(extractStaffFromRequest → canAccessCustomer、admin・iPad店舗共通
 * ログイン以外は自分が担当の予約のみ)。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServiceClient } from '../../../../lib/repos'
import { toValidationErrorResponse } from '../../../_schemas/common'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'
import { SHARED_IPAD_STAFF_USER_ID } from '@/lib/constants'
import {
  buildScheduledAtJst, formatJstMonthDayTime, isPastDateTime, reservationsOverlap,
} from '@/lib/reservations/reschedule'

const reservationIdSchema = z.string().uuid()

const bodySchema = z.object({
  date:            z.string(),
  time:            z.string(),
  allowOverlap:    z.boolean().optional(),
  brainCustomerId: z.string().uuid().optional(),
})

interface ReservationRow {
  id:                string
  customer_id:       string | null
  brain_customer_id: string | null
  staff_id:          string
  menu:              string
  price:             number
  scheduled_at:      string
  duration_minutes:  number
  status:            string
  is_new_customer:   boolean
  notes:             string | null
  customer_hash_id:  string | null
}

const SELECT_COLUMNS =
  'id, customer_id, brain_customer_id, staff_id, menu, price, scheduled_at, duration_minutes, status, is_new_customer, notes, customer_hash_id'

function appendNote(base: string | null, addition: string): string {
  return base && base.trim() ? `${base} / ${addition}` : addition
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const staff = await extractStaffFromRequest(req)
  if (!staff) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const idResult = reservationIdSchema.safeParse(id)
  if (!idResult.success) {
    return NextResponse.json({ success: false, error: '無効な予約ID形式です。' }, { status: 400 })
  }
  const reservationId = idResult.data

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(toValidationErrorResponse(parsed.error), { status: 400 })
  }
  const { date, time, allowOverlap, brainCustomerId } = parsed.data

  const newScheduledAt = buildScheduledAtJst(date, time)
  if (!newScheduledAt) {
    return NextResponse.json({ success: false, error: 'invalid_datetime' }, { status: 400 })
  }
  if (isPastDateTime(newScheduledAt)) {
    return NextResponse.json({ success: false, error: 'past_datetime' }, { status: 400 })
  }

  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('reservations')
    .select(SELECT_COLUMNS)
    .eq('id', reservationId)
    .maybeSingle()
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ success: false, error: 'reservation_not_found' }, { status: 404 })
  }
  const original = data as ReservationRow

  if (!original.brain_customer_id) {
    return NextResponse.json({ success: false, error: 'reservation_without_customer' }, { status: 409 })
  }
  if (brainCustomerId && brainCustomerId !== original.brain_customer_id) {
    return NextResponse.json({ success: false, error: 'customer_mismatch' }, { status: 409 })
  }

  const accessible = await canAccessCustomer(staff.staffBrainId, original.brain_customer_id, staff.isAdmin)
  if (!accessible) {
    return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 })
  }
  const seesAll = staff.isAdmin || staff.authUserId === SHARED_IPAD_STAFF_USER_ID
  if (!seesAll && original.staff_id !== staff.authUserId) {
    return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 })
  }

  // 移せるのは未対応(confirmed)の予約のみ。変更済み・対応中・完了済みは対象外。
  if (original.status !== 'confirmed') {
    return NextResponse.json({ success: false, error: 'invalid_status' }, { status: 409 })
  }
  if (new Date(original.scheduled_at).getTime() === new Date(newScheduledAt).getTime()) {
    return NextResponse.json({ success: false, error: 'same_datetime' }, { status: 400 })
  }

  // 同じ担当スタッフの予約との重なり確認(前後12時間を候補にして、所要時間で厳密に判定)。
  if (!allowOverlap) {
    const center = new Date(newScheduledAt).getTime()
    const from = new Date(center - 12 * 3_600_000).toISOString()
    const to = new Date(center + 12 * 3_600_000).toISOString()
    const { data: nearby, error: nearbyError } = await supabase
      .from('reservations')
      .select('id, scheduled_at, duration_minutes')
      .eq('staff_id', original.staff_id)
      .in('status', ['confirmed', 'in_progress'])
      .neq('id', reservationId)
      .gte('scheduled_at', from)
      .lte('scheduled_at', to)
    if (nearbyError) {
      return NextResponse.json({ success: false, error: nearbyError.message }, { status: 500 })
    }
    const conflicts = ((nearby ?? []) as { id: string; scheduled_at: string; duration_minutes: number }[])
      .filter(r => reservationsOverlap(newScheduledAt, original.duration_minutes, r.scheduled_at, r.duration_minutes))
    if (conflicts.length > 0) {
      return NextResponse.json({
        success: false, error: 'slot_conflict',
        conflicts: conflicts.map(c => ({ scheduled_at: c.scheduled_at, duration_minutes: c.duration_minutes })),
      }, { status: 409 })
    }
  }

  // 1. 新しい日時の予約を作成
  const movedFrom = formatJstMonthDayTime(original.scheduled_at)
  const { data: created, error: createError } = await supabase
    .from('reservations')
    .insert({
      customer_id:       original.customer_id,
      brain_customer_id: original.brain_customer_id,
      customer_hash_id:  original.customer_hash_id,
      staff_id:          original.staff_id,
      menu:              original.menu,
      price:             original.price,
      scheduled_at:      newScheduledAt,
      duration_minutes:  original.duration_minutes,
      status:            'confirmed',
      is_new_customer:   original.is_new_customer,
      notes:             appendNote(original.notes, `別日に予約（元の予約: ${movedFrom}）`),
    })
    .select('id')
    .single()
  if (createError || !created) {
    return NextResponse.json({ success: false, error: createError?.message ?? 'create_failed' }, { status: 500 })
  }
  const createdId = (created as { id: string }).id

  // 2. 元の予約を「変更」にする(削除しない)。失敗したら1で作った予約を削除して元に戻す。
  const cancelledAt = new Date().toISOString()
  const movedTo = formatJstMonthDayTime(newScheduledAt)
  const { data: updated, error: updateError } = await supabase
    .from('reservations')
    .update({
      status: 'cancelled', cancelled_at: cancelledAt, cancel_source: 'manual',
      notes: appendNote(original.notes, `別日に変更 → ${movedTo}`),
    })
    .eq('id', reservationId)
    .eq('status', 'confirmed') // 二重送信対策(楽観的排他)
    .select('id')
  if (updateError || !updated || updated.length === 0) {
    await supabase.from('reservations').delete().eq('id', createdId)
    if (updateError) {
      return NextResponse.json({ success: false, error: updateError.message }, { status: 500 })
    }
    return NextResponse.json({ success: false, error: 'conflict' }, { status: 409 })
  }

  return NextResponse.json({
    success: true,
    original: { id: reservationId, status: 'cancelled', cancelled_at: cancelledAt, cancel_source: 'manual' },
    created:  { id: createdId, scheduled_at: newScheduledAt, duration_minutes: original.duration_minutes },
  }, { status: 201 })
}
