import { describe, it, expect } from 'vitest'
import { extractVoiceMemoCategories } from '@/lib/voiceInsight/extractVoiceMemoCategories'

describe('extractVoiceMemoCategories', () => {
  it('classifies a transcript touching multiple categories', () => {
    const transcript =
      '本日はフェイシャルの施術を行いました。アレルギーがあるとのことで注意が必要です。' +
      'ホームケアの使い方を説明しました。次回来店時に肌の状態を確認してください。' +
      '乾燥が気になるとおっしゃっていました。'
    const { tags } = extractVoiceMemoCategories(transcript)

    expect(tags).toContain('category_treatment')
    expect(tags).toContain('category_contraindication')
    expect(tags).toContain('category_homecare')
    expect(tags).toContain('category_next_visit_check')
    expect(tags).toContain('category_concern') // dryness_concern経由で導出
  })

  it('returns no tags when nothing matches (does not force a category)', () => {
    const { tags } = extractVoiceMemoCategories('特に変わったことはありませんでした')
    expect(tags).toEqual([])
  })

  it('returns no tags for empty/null/undefined input', () => {
    expect(extractVoiceMemoCategories('').tags).toEqual([])
    expect(extractVoiceMemoCategories(null).tags).toEqual([])
    expect(extractVoiceMemoCategories(undefined).tags).toEqual([])
  })

  it('does not classify concern without a matching skin-concern keyword', () => {
    const { tags } = extractVoiceMemoCategories('本日は施術を行いました。')
    expect(tags).toContain('category_treatment')
    expect(tags).not.toContain('category_concern')
  })
})
