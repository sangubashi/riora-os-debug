/**
 * reservationStatusMapper.ts — 予約CSV「ステータス」→ reservations.status 変換
 *
 * 設計根拠: docs/design/RESERVATION_IMPORT_V1.md §2(RES-2確定ルール)・RES-8拡張
 *   受付待ち        → confirmed
 *   会計済み        → completed
 *   お客様キャンセル → cancelled
 *   サロンキャンセル → cancelled(RES-8追加。サロン都合のキャンセルもreservations.status
 *                     のCHECK制約上はお客様都合キャンセルと同じcancelled以外に区分先が無いため)
 * 上記以外(想定外の値)は unresolved としてImport側でスキップ対象に回す。
 */

export type ReservationStatus = 'confirmed' | 'in_progress' | 'completed' | 'cancelled'

const STATUS_MAP: Record<string, ReservationStatus> = {
  '受付待ち':        'confirmed',
  '会計済み':        'completed',
  'お客様キャンセル': 'cancelled',
  'サロンキャンセル': 'cancelled',
}

export type StatusResolution =
  | { status: 'resolved'; value: ReservationStatus }
  | { status: 'unresolved'; raw: string }

export function mapReservationStatus(raw: string): StatusResolution {
  const value = STATUS_MAP[raw.trim()]
  if (value) return { status: 'resolved', value }
  return { status: 'unresolved', raw }
}
