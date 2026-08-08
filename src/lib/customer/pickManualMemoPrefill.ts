import type { CustomerNote } from '@/types'

/**
 * CustomerBottomSheetの「前回のメモ」欄プリフィル候補を選ぶ。
 * カルテ取込由来(source='salonboard')は手動メモとは別物のため、プリフィル対象から除外する。
 * notesは created_at desc（新しい順）で渡される前提。
 */
export function pickManualMemoPrefill(notes: CustomerNote[]): string | null {
  return notes.find(n => n.source !== 'salonboard' && n.note)?.note ?? null
}
