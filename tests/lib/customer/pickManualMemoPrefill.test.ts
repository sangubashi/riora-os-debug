import { describe, expect, it } from 'vitest'
import { pickManualMemoPrefill } from '@/lib/customer/pickManualMemoPrefill'
import type { CustomerNote } from '@/types'

function note(overrides: Partial<CustomerNote>): CustomerNote {
  return {
    id:            'note-1',
    customer_id:   'cust-1',
    staff_id:      'staff-1',
    note:          'メモ本文',
    category:      null,
    source:        'manual',
    voice_note_id: null,
    created_at:    '2026-08-08T00:00:00Z',
    ...overrides,
  }
}

describe('pickManualMemoPrefill', () => {
  it('直近がmanualならその内容を返す(従来通り)', () => {
    const notes = [note({ source: 'manual', note: '手動メモ' })]
    expect(pickManualMemoPrefill(notes)).toBe('手動メモ')
  })

  it('直近がvoice_noteならその内容を返す(従来通り)', () => {
    const notes = [note({ source: 'voice_note', note: '音声由来メモ' })]
    expect(pickManualMemoPrefill(notes)).toBe('音声由来メモ')
  })

  it('直近がsalonboard(カルテ取込由来)ならスキップし、次のmanualを返す', () => {
    const notes = [
      note({ source: 'salonboard', note: 'カルテ取込メモ', created_at: '2026-08-08T02:00:00Z' }),
      note({ source: 'manual',     note: '手動メモ',       created_at: '2026-08-07T00:00:00Z' }),
    ]
    expect(pickManualMemoPrefill(notes)).toBe('手動メモ')
  })

  it('全てsalonboardの場合はnullを返す(プリフィルしない)', () => {
    const notes = [
      note({ source: 'salonboard', note: 'カルテ取込メモ1' }),
      note({ source: 'salonboard', note: 'カルテ取込メモ2' }),
    ]
    expect(pickManualMemoPrefill(notes)).toBeNull()
  })

  it('空配列の場合はnullを返す', () => {
    expect(pickManualMemoPrefill([])).toBeNull()
  })

  it('note本文が空文字のsalonboard以外の行はスキップする(従来のtruthy判定を維持)', () => {
    const notes = [
      note({ source: 'manual', note: '' }),
      note({ source: 'manual', note: '有効なメモ' }),
    ]
    expect(pickManualMemoPrefill(notes)).toBe('有効なメモ')
  })
})
