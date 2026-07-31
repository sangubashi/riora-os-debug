/**
 * extractVoiceMemoCategories.ts (PHASE VOICE-MEMO-COMPLETE)
 *
 * 音声メモ文字起こしを、以下の7カテゴリへルールベースで分類する。
 * AI不使用・決定論的キーワードマッチングのみ（extractInsightTags.tsと同一方針）。
 * 該当するカテゴリのみを返す（マッチしないカテゴリは付けない。「分類できるものだけ
 * 分類する」というユーザー指示に従う）。
 *
 * 分類結果はDBの新カラムを追加せず、既存の voice_notes.insight_tags(text[])に
 * 他のInsightTagと同じ形式でマージして保存する(migration禁止のため)。
 * VoiceNotesList.tsx等の既存UIは insight_tags を INSIGHT_TAG_LABELS 経由で
 * そのままバッジ表示する設計のため、このファイル・INSIGHT_TAG_LABELSへの追加だけで
 * 新規UIコードなしに分類タグが表示される。
 *
 * 「悩み」は独自キーワードを持たず、extractInsightTags.ts が既に持つ肌悩み系タグ
 * (dryness_concern/sensitive_skin/acne_concern/aging_concern/redness_concern)の
 * いずれかが検出された場合に導出する(同じ判定の二重実装を避けるため)。
 */

import type { InsightTag } from '@/types'
import { extractInsightTags } from './extractInsightTags'

export type VoiceMemoCategoryTag =
  | 'category_treatment'         // 施術内容
  | 'category_concern'           // 悩み
  | 'category_contraindication'  // 禁忌
  | 'category_homecare'          // ホームケア
  | 'category_conversation'      // 会話メモ
  | 'category_important'         // 重要事項
  | 'category_next_visit_check'  // 次回来店で確認すること

interface CategoryRule {
  keywords: string[]
}

const CONCERN_SOURCE_TAGS: InsightTag[] = [
  'dryness_concern', 'sensitive_skin', 'acne_concern', 'aging_concern', 'redness_concern',
]

const CATEGORY_RULES: Record<Exclude<VoiceMemoCategoryTag, 'category_concern'>, CategoryRule> = {
  category_treatment: {
    keywords: [
      '施術', 'トリートメント', 'マッサージ', 'パック', 'ピーリング', 'クレンジング',
      'フェイシャル', 'ボディ', '毛穴ケア', '美容液', 'コース', '導入', 'イオン導入',
    ],
  },
  category_contraindication: {
    keywords: [
      '禁忌', 'アレルギー', '妊娠', '持病', '既往', '炎症中', 'ケロイド', '金属アレルギー',
      '施術不可', 'ドクターストップ', '服薬', '投薬中', '傷がある', 'かぶれやすい',
    ],
  },
  category_homecare: {
    keywords: [
      'ホームケア', '自宅ケア', '自宅でも', '家でも', '毎日のケア', 'スキンケア',
      '使い方', '使用方法', '塗布', '朝晩', '毎日使って',
    ],
  },
  category_conversation: {
    keywords: [
      '世間話', '雑談', '近況', 'お子さん', 'ご家族', '旅行', 'お仕事の話', '趣味の話',
      '結婚式', '誕生日', '記念日',
    ],
  },
  category_important: {
    keywords: [
      '重要', '必ず', '絶対', '注意してください', '忘れずに', '要注意', '大事な', '念のため',
    ],
  },
  category_next_visit_check: {
    keywords: [
      '次回', '次のご来店', '今度来た時', '次来た時', '確認してください', '聞いておいて',
      'チェックしてください', '次回までに', '経過を見て',
    ],
  },
}

export interface VoiceMemoCategoryResult {
  tags: VoiceMemoCategoryTag[]
}

/**
 * transcriptを7カテゴリへ分類する。マッチしたものだけを返す(全件必須ではない)。
 * 判定順は施術内容→禁忌→ホームケア→会話メモ→重要事項→次回確認→悩み(既存タグ導出)。
 */
export function extractVoiceMemoCategories(transcript: string | null | undefined): VoiceMemoCategoryResult {
  const text = (transcript ?? '').trim()
  if (text.length === 0) return { tags: [] }

  const tags: VoiceMemoCategoryTag[] = []

  for (const [tag, rule] of Object.entries(CATEGORY_RULES) as [Exclude<VoiceMemoCategoryTag, 'category_concern'>, CategoryRule][]) {
    if (rule.keywords.some(kw => text.includes(kw))) {
      tags.push(tag)
    }
  }

  // 「悩み」= 既存の肌悩み系InsightTagのいずれかが検出された場合のみ付与(二重実装回避)。
  const { tags: existingTags } = extractInsightTags([text])
  if (existingTags.some(t => CONCERN_SOURCE_TAGS.includes(t))) {
    tags.push('category_concern')
  }

  return { tags }
}
