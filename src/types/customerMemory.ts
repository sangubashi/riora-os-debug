/**
 * CustomerMemory 型定義
 *
 * 絶対ルール: このファイルを ProposalOrchestrator / FireScore /
 * AI提案 / LINE提案 のいずれにも import しないこと。
 * content は接客支援AIには渡さない。
 */

export type MemoryType =
  | 'family'
  | 'anniversary'
  | 'hobby'
  | 'occupation'
  | 'life_event'
  | 'travel'
  | 'pet'
  | 'other'

export type MemoryImportance = 'low' | 'medium' | 'high'

export interface CustomerMemory {
  id:           string
  customer_id:  string
  store_id:     string
  content:      string
  memory_type:  MemoryType
  trigger_date: string | null
  importance:   MemoryImportance
  is_sensitive: boolean
  created_by:   string | null
  created_at:   string
}

export const MEMORY_TYPE_LABELS: Record<MemoryType, string> = {
  family:      '家族',
  anniversary: '記念日',
  hobby:       '趣味',
  occupation:  '職業',
  life_event:  'ライフイベント',
  travel:      '旅行',
  pet:         'ペット',
  other:       'その他',
}

export const MEMORY_TYPE_EMOJI: Record<MemoryType, string> = {
  family:      '👨‍👩‍👧',
  anniversary: '🎂',
  hobby:       '⛳',
  occupation:  '💼',
  life_event:  '🌱',
  travel:      '✈️',
  pet:         '🐾',
  other:       '📝',
}

export const IMPORTANCE_LABELS: Record<MemoryImportance, string> = {
  low:    '低',
  medium: '中',
  high:   '高',
}
