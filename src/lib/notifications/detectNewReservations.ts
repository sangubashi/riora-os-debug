/**
 * detectNewReservations.ts — 📋新規予約検出ロジック(純粋関数・DB非依存)
 *
 * Riora_アプリ内通知v1_祝福気遣いカード_設計書_v1.0.md §1・§4準拠。
 * 「週1 CSV取込後(差分)」を、新規テーブルを作らずに近似する設計。
 *
 * 判定根拠(調査済み): reservationImportPipeline.ts の予約upsertは
 * find→insert/update分岐であり、update時のpayloadにcreated_atを含まない
 * (ReservationRepo.ts toDbInput())。そのためDBのcreated_atはINSERT時の
 * now()から更新されず、「本当に新規作成された予約行」だけを示す信頼できる
 * シグナルとして使える(既存予約が再取込で更新されてもcreated_atは変わらない)。
 *
 * NEW_RESERVATION_WINDOW_DAYSは週1取込に遅延バッファを見込んだ値(要運用調整)。
 */
import type { StaffNotification } from '@/types/notifications'

const MS_PER_DAY = 86_400_000
const NEW_RESERVATION_WINDOW_DAYS = 10 // 週1取込+遅延バッファ

export interface NewReservationInput {
  reservationId: string
  customerId:    string
  customerName:  string
  scheduledAt:   string // ISO
  createdAt:     string // ISO(reservations.created_at)
}

function daysSince(dateStr: string, today: Date): number {
  const diff = today.getTime() - new Date(dateStr).getTime()
  return Math.round(diff / MS_PER_DAY)
}

/** JST表記の "M/D HH:MM" ラベルを作る(設計書§2の表示例「新規予約 7/25 14:00」に合わせる)。 */
function jstLabel(iso: string): string {
  const jst = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000)
  const month = jst.getUTCMonth() + 1
  const date = jst.getUTCDate()
  const hh = String(jst.getUTCHours()).padStart(2, '0')
  const mm = String(jst.getUTCMinutes()).padStart(2, '0')
  return `${month}/${date} ${hh}:${mm}`
}

/** 予約1件が「新規予約通知」の対象かどうかを判定する(純粋関数)。対象外はnull。 */
export function buildNewReservationNotification(
  input: NewReservationInput,
  today: Date = new Date()
): StaffNotification | null {
  const daysSinceCreated = daysSince(input.createdAt, today)
  if (daysSinceCreated < 0 || daysSinceCreated > NEW_RESERVATION_WINDOW_DAYS) return null

  // 過去日程になった予約はもう「新規案内」の意味が薄いため対象外
  if (new Date(input.scheduledAt).getTime() < today.getTime()) return null

  return {
    id: `new_reservation:${input.customerId}:${input.reservationId}`,
    kind: 'new_reservation',
    emoji: '📋',
    title: `新規予約 ${jstLabel(input.scheduledAt)}`,
    customerId: input.customerId,
    customerName: input.customerName,
  }
}

export function buildNewReservationNotifications(
  inputs: NewReservationInput[],
  today: Date = new Date()
): StaffNotification[] {
  const results: StaffNotification[] = []
  for (const input of inputs) {
    const n = buildNewReservationNotification(input, today)
    if (n) results.push(n)
  }
  return results
}
