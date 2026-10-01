/**
 * PATCH /api/reservations/[id]/cancel — 当日キャンセル / キャンセル取消(/karte)
 *
 * body: { action: 'cancel' | 'restore', brainCustomerId?: string }
 *
 * 予約は削除しない。reservations.statusと(cancelled_at, cancel_source)の更新のみ。
 *   cancel : confirmed → cancelled / cancelled_at=now / cancel_source='manual'
 *   restore: cancelled(かつcancel_source='manual') → confirmed / cancelled_at=NULL / cancel_source=NULL
 * 元の予約日時・顧客・スタッフ・メニュー等には一切触れない。
 *
 * 認証・権限(既存方式の踏襲・新しい認証方式は作らない):
 *   - extractStaffFromRequest(JWT)
 *   - canAccessCustomer(予約の顧客に対するアクセス権)
 *   - GET /api/home/reservationsと同じ範囲: admin・iPad店舗共通ログインは全予約、
 *     それ以外のスタッフは自分が担当(reservations.staff_id=authUserId)の予約のみ。
 *
 * 不正な状態遷移は409(already_cancelled / not_cancelled / not_manual_cancel / invalid_status)。
 * 二重送信・連打は、更新時に「現在のstatus」を条件に含める(楽観的排他)ことで、
 * 先に成功した1回のみが反映され2回目以降は409になる。
 *
 * CSV再取込との関係: cancel_source='manual'の予約はreservationImportPipeline.tsが
 * CSVで上書きしない(保護)。取消(restore)でcancel_sourceがNULLに戻れば通常どおり
 * CSVの内容で更新される。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServiceClient } from '../../../../lib/repos'
import { toValidationErrorResponse } from '../../../_schemas/common'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'
import { SHARED_IPAD_STAFF_USER_ID } from '@/lib/constants'

const reservationIdSchema = z.string().uuid()

const bodySchema = z.object({
  action:          z.enum(['cancel', 'restore']),
  brainCustomerId: z.string().uuid().optional(),
})

interface ReservationCancelRow {
  id:                string
  brain_customer_id: string | null
  staff_id:          string | null
  status:            string
  cancelled_at:      string | null
  cancel_source:     string | null
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const staff = await extractStaffFromRequest(req)
  if (!staff) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 })
  }

  // 予約IDがUUID形式でなければ、DBへ問い合わせる前に400で拒否する(不正な値がPostgresの
  // 型エラー=500になるのを防ぐ)。本番のreservations.idは全件この形式(gen_random_uuid)。
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
  const { action, brainCustomerId } = parsed.data

  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('reservations')
    .select('id, brain_customer_id, staff_id, status, cancelled_at, cancel_source')
    .eq('id', reservationId)
    .maybeSingle()
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ success: false, error: 'reservation_not_found' }, { status: 404 })
  }
  const reservation = data as ReservationCancelRow

  // 顧客の整合性: 予約はbrain_customer_id連携済みのものだけが対象。UIが表示中の顧客IDを
  // 送ってきた場合は一致を確認する(別顧客の予約IDを誤って指定する事故の防止)。
  if (!reservation.brain_customer_id) {
    return NextResponse.json({ success: false, error: 'reservation_without_customer' }, { status: 409 })
  }
  if (brainCustomerId && brainCustomerId !== reservation.brain_customer_id) {
    return NextResponse.json({ success: false, error: 'customer_mismatch' }, { status: 409 })
  }

  const accessible = await canAccessCustomer(staff.staffBrainId, reservation.brain_customer_id, staff.isAdmin)
  if (!accessible) {
    return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 })
  }
  // GET /api/home/reservationsと同じ範囲(admin・iPad店舗共通ログイン以外は自分の担当のみ)。
  const seesAll = staff.isAdmin || staff.authUserId === SHARED_IPAD_STAFF_USER_ID
  if (!seesAll && reservation.staff_id !== staff.authUserId) {
    return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 })
  }

  if (action === 'cancel') {
    if (reservation.status === 'cancelled') {
      return NextResponse.json({ success: false, error: 'already_cancelled' }, { status: 409 })
    }
    // 元に戻せる(restoreがconfirmedへ戻す)ことを保証するため、cancelできるのはconfirmedのみ。
    if (reservation.status !== 'confirmed') {
      return NextResponse.json({ success: false, error: 'invalid_status' }, { status: 409 })
    }
    const cancelledAt = new Date().toISOString()
    const { data: updated, error: updateError } = await supabase
      .from('reservations')
      .update({ status: 'cancelled', cancelled_at: cancelledAt, cancel_source: 'manual' })
      .eq('id', reservationId)
      .eq('status', 'confirmed') // 二重送信対策(楽観的排他)
      .select('id')
    if (updateError) {
      return NextResponse.json({ success: false, error: updateError.message }, { status: 500 })
    }
    if (!updated || updated.length === 0) {
      return NextResponse.json({ success: false, error: 'conflict' }, { status: 409 })
    }
    return NextResponse.json({
      success: true,
      reservation: { id: reservationId, status: 'cancelled', cancelled_at: cancelledAt, cancel_source: 'manual' },
    })
  }

  // action === 'restore'
  if (reservation.status !== 'cancelled') {
    return NextResponse.json({ success: false, error: 'not_cancelled' }, { status: 409 })
  }
  // 取消できるのは手動キャンセルのみ(サロンボードCSV由来・過去データのcancelledは対象外)。
  if (reservation.cancel_source !== 'manual') {
    return NextResponse.json({ success: false, error: 'not_manual_cancel' }, { status: 409 })
  }
  const { data: restored, error: restoreError } = await supabase
    .from('reservations')
    .update({ status: 'confirmed', cancelled_at: null, cancel_source: null })
    .eq('id', reservationId)
    .eq('status', 'cancelled')
    .eq('cancel_source', 'manual')
    .select('id')
  if (restoreError) {
    return NextResponse.json({ success: false, error: restoreError.message }, { status: 500 })
  }
  if (!restored || restored.length === 0) {
    return NextResponse.json({ success: false, error: 'conflict' }, { status: 409 })
  }
  return NextResponse.json({
    success: true,
    reservation: { id: reservationId, status: 'confirmed', cancelled_at: null, cancel_source: null },
  })
}
