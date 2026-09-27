import { describe, expect, it } from 'vitest'
import { toHiragana, kanaIncludes } from '@/lib/customer/kanaMatch'

describe('toHiragana', () => {
  it('全角カタカナをひらがなへ変換する', () => {
    expect(toHiragana('サイトウ')).toBe('さいとう')
  })

  it('ひらがな・漢字・記号はそのまま返す', () => {
    expect(toHiragana('齋藤 さいとう123')).toBe('齋藤 さいとう123')
  })
})

describe('kanaIncludes', () => {
  it('カタカナのname_kanaに対してひらがなの検索語で一致する', () => {
    expect(kanaIncludes('サイトウ', 'さいとう')).toBe(true)
  })

  it('ひらがなのname_kanaに対してカタカナの検索語で一致する', () => {
    expect(kanaIncludes('わたなべ', 'ワタナベ')).toBe(true)
  })

  it('部分一致で判定する', () => {
    expect(kanaIncludes('ワタナベ', 'たなべ')).toBe(true)
  })

  it('一致しない場合はfalse', () => {
    expect(kanaIncludes('サイトウ', 'すずき')).toBe(false)
  })

  it('name_kanaがnull/undefinedならfalse', () => {
    expect(kanaIncludes(null, 'さいとう')).toBe(false)
    expect(kanaIncludes(undefined, 'さいとう')).toBe(false)
  })
})
