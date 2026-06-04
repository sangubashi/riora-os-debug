/**
 * aiMemory.ts
 * 顧客の会話（transcript・summary）から「記憶」を抽出し DB 保存。
 *
 * 設計: deterministic + 将来 AI 差し替えポイント明確化。
 * 副作用: Supabase customer_memories テーブルへの書き込み。
 */

import { supabase, DEMO_MODE } from '@/lib/supabase'
import { prodLog } from '@/lib/stability'
import type { MemoryItem } from '@/types'

// ─── DEMO_MODE 用ダミーデータ ─────────────────────────────────────────────────

const DEMO_MEMORIES: MemoryItem[] = [
  {
    id:          'demo-m1',
    customer_id: 'demo',
    category:    'skin',
    content:     '乾燥・エイジングへの強い関心',
    source:      'voice_note',
    confidence:  0.8,
    created_at:  new Date(Date.now() - 42 * 86400000).toISOString(),
  },
  {
    id:          'demo-m2',
    customer_id: 'demo',
    category:    'preference',
    content:     '上質・特別感のある提案を好む',
    source:      'voice_note',
    confidence:  0.75,
    created_at:  new Date(Date.now() - 14 * 86400000).toISOString(),
  },
  {
    id:          'demo-m3',
    customer_id: 'demo',
    category:    'hobby',
    content:     '多忙なライフスタイル。時短ケアを好む',
    source:      'voice_note',
    confidence:  0.7,
    created_at:  new Date(Date.now() - 42 * 86400000).toISOString(),
  },
]


// ─── キーワード → カテゴリ マッピング ─────────────────────────────────────────

interface MemoryRule {
  category: MemoryItem['category']
  patterns: RegExp[]
  extract:  (match: string, text: string) => string | null
}

const MEMORY_RULES: MemoryRule[] = [
  // ライフイベント
  {
    category: 'life',
    patterns: [
      /結婚式|披露宴|婚活|妊娠|出産|育児|入学|卒業|就職|転職|引越|退職/,
    ],
    extract: (_, text) => {
      const sentence = extractSentence(text, /結婚式|披露宴|婚活|妊娠|出産|育児|入学|卒業|就職|転職|引越|退職/)
      return sentence ? `${sentence}` : null
    },
  },
  // イベント
  {
    category: 'event',
    patterns: [
      /同窓会|パーティー|デート|旅行|発表会|式典|記念日|誕生日|クリスマス/,
    ],
    extract: (_, text) => {
      const sentence = extractSentence(text, /同窓会|パーティー|デート|旅行|発表会|式典|記念日|誕生日|クリスマス/)
      return sentence ? `${sentence}` : null
    },
  },
  // 趣味・好み
  {
    category: 'hobby',
    patterns: [
      /好き|趣味|ヨガ|ピラティス|ランニング|料理|読書|旅行|映画|ゴルフ|テニス|スポーツ/,
    ],
    extract: (_, text) => {
      const sentence = extractSentence(text, /好き|趣味|ヨガ|ピラティス|ランニング|料理|読書|映画|ゴルフ/)
      return sentence ? `${sentence}` : null
    },
  },
  // 肌悩み（細かい言及）
  {
    category: 'skin',
    patterns: [
      /ニキビ|シミ|たるみ|シワ|毛穴|乾燥|赤み|くすみ|ハリ|肌荒れ/,
    ],
    extract: (_, text) => {
      const sentence = extractSentence(text, /ニキビ|シミ|たるみ|シワ|毛穴|乾燥|赤み|くすみ|ハリ|肌荒れ/)
      return sentence ? `${sentence}` : null
    },
  },
  // こだわり・嗜好
  {
    category: 'preference',
    patterns: [
      /アレルギー|苦手|香り|刺激|天然|オーガニック|添加物|こだわり/,
    ],
    extract: (_, text) => {
      const sentence = extractSentence(text, /アレルギー|苦手|香り|刺激|天然|オーガニック|添加物/)
      return sentence ? `${sentence}` : null
    },
  },
]

// ─── テキストからセンテンス抽出 ───────────────────────────────────────────────

function extractSentence(text: string, pattern: RegExp): string | null {
  // 句点・改行で分割してパターンにマッチする文を返す
  const sentences = text.split(/[。\n。]/).map(s => s.trim()).filter(Boolean)
  for (const s of sentences) {
    if (pattern.test(s)) {
      // 長すぎる文は切り詰め
      return s.length > 60 ? s.slice(0, 57) + '…' : s
    }
  }
  return null
}

// ─── メモリ抽出メイン ─────────────────────────────────────────────────────────

export interface ExtractedMemory {
  category:   MemoryItem['category']
  content:    string
  confidence: number
}

/**
 * テキスト（transcript / summary）から記憶候補を抽出。
 * 将来: Claude API に差し替えで精度向上可能。
 */
export function extractMemoryCandidates(text: string): ExtractedMemory[] {
  if (!text || text.length < 10) return []

  const results: ExtractedMemory[] = []
  const seen = new Set<string>()

  for (const rule of MEMORY_RULES) {
    for (const pattern of rule.patterns) {
      if (!pattern.test(text)) continue
      const content = rule.extract(pattern.source, text)
      if (!content || seen.has(content)) continue
      seen.add(content)
      results.push({
        category:   rule.category,
        content,
        confidence: 0.7, // mock confidence
      })
    }
  }

  return results
}

// ─── Supabase 保存 ────────────────────────────────────────────────────────────

export async function saveMemoryItems(
  customerId: string,
  items:      ExtractedMemory[]
): Promise<void> {
  if (items.length === 0) return
  if (DEMO_MODE) return   // Supabase を呼ばない

  const rows = items.map(item => ({
    customer_id: customerId,
    category:    item.category,
    content:     item.content,
    source:      'voice_note' as const,
    confidence:  item.confidence,
  }))

  const { error } = await supabase
    .from('customer_memories')
    .insert(rows)

  if (error) {
    prodLog('error', '[aiMemory] 保存失敗:', error.message)
  }
}

// ─── 顧客記憶取得 ─────────────────────────────────────────────────────────────

export async function fetchCustomerMemories(
  customerId: string,
  limit = 8
): Promise<MemoryItem[]> {
  // DEMO_MODE: Supabase を呼ばずダミーデータを返す
  if (DEMO_MODE) return DEMO_MEMORIES.slice(0, limit)

  const { data, error } = await supabase
    .from('customer_memories')
    .select('id, customer_id, category, content, source, confidence, created_at')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error || !data) {
    prodLog('warn', '[aiMemory] 取得失敗:', error?.message)
    return []
  }

  return data as MemoryItem[]
}
