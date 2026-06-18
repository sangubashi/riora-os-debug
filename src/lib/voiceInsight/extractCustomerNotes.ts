/**
 * extractCustomerNotes.ts
 * transcript / summary から Family / Work / Health / Preference / Event ノートを抽出。
 * deterministic キーワードマッチング。将来は LLM に差し替え可。
 */

import type { NoteCategory } from '@/types'

export interface ExtractedNote {
  category: NoteCategory
  content:  string
}

interface CategoryRule {
  category: NoteCategory
  keywords: string[]
}

const CATEGORY_RULES: CategoryRule[] = [
  {
    category: 'Family',
    keywords: [
      '家族', '子供', '子ども', 'こども', '娘', '息子', '夫', '妻', '旦那',
      '母', '父', 'お母さん', 'お父さん', '兄弟', '姉妹', '孫', 'おばあちゃん',
      'おじいちゃん', 'パパ', 'ママ', '家庭', 'お子さん', '子育て', '育児',
    ],
  },
  {
    category: 'Work',
    keywords: [
      '仕事', '会社', '職場', '残業', '転職', '出張', '上司', '部下',
      'プロジェクト', '会議', '職業', '勤務', 'キャリア', '業務', '仕事先',
      '職種', 'オフィス', '勤め', '就職', '退職', '在宅勤務', 'テレワーク',
    ],
  },
  {
    category: 'Health',
    keywords: [
      '体調', '健康', '病気', '薬', 'お薬', '病院', 'アレルギー', '不眠',
      '疲れ', '疲労', '持病', '更年期', 'ダイエット', '運動', '体重', '血圧',
      '睡眠', '身体', 'からだ', '腰痛', '頭痛', '肩こり', '通院',
    ],
  },
  {
    category: 'Preference',
    keywords: [
      '好き', '嫌い', '趣味', '好み', 'お気に入り', '好物', '苦手', '得意',
      '音楽', '映画', '読書', 'スポーツ', '料理', 'グルメ', 'ファッション',
      '好きな', 'ゴルフ', 'テニス', 'ヨガ', 'カフェ', 'ランニング',
    ],
  },
  {
    category: 'Event',
    keywords: [
      '結婚式', '誕生日', '記念日', 'パーティー', '入学', '卒業', '式典',
      'イベント', '旅行', '卒園', '発表会', '同窓会', 'お祝い', '出産',
      '新居', '引越', '披露宴', 'お正月', 'クリスマス', '七五三', '成人式',
    ],
  },
]

function splitToSentences(text: string): string[] {
  return text
    .split(/[。！？\n]/)
    .map(s => s.trim())
    .filter(s => s.length >= 8 && !s.startsWith('[') && !s.startsWith('（'))
}

/**
 * transcript + summary から分類ノートを抽出する。
 * 同一カテゴリ・同一内容は1件のみ返す（呼び出し内 dedup）。
 */
export function extractCustomerNotes(
  transcript: string | null,
  summary:    string | null,
): ExtractedNote[] {
  const texts = [transcript, summary].filter((t): t is string => !!t && t.length > 5)
  if (texts.length === 0) return []

  const results: ExtractedNote[] = []
  const seen = new Set<string>()

  for (const text of texts) {
    const sentences = splitToSentences(text)
    for (const sentence of sentences) {
      for (const rule of CATEGORY_RULES) {
        if (!rule.keywords.some(kw => sentence.includes(kw))) continue

        const dedupeKey = `${rule.category}:${sentence.slice(0, 30)}`
        if (seen.has(dedupeKey)) break
        seen.add(dedupeKey)

        results.push({ category: rule.category, content: sentence })
        break // 1文につき1カテゴリ（最初にマッチしたもの）
      }
    }
  }

  return results
}
