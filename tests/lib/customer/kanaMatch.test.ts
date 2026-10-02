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

import { customerNameMatchRank, customerNameMatches, normalizeForSearch, stripSpaces } from '../../../src/lib/customer/kanaMatch'

describe('顧客検索の強化(部分一致・姓名またぎ・ひらがな/カタカナ)', () => {
  const shimotsu = { name: '下津 里恵', kana: 'シモツ リエ' }
  const hit = (q: string) => customerNameMatches(shimotsu.name, shimotsu.kana, q)

  it('正規化: カタカナ→ひらがな、半角・全角の空白を除去、小文字化', () => {
    expect(normalizeForSearch('シモツ　リエ')).toBe('しもつりえ')
    expect(stripSpaces(' a　b\tc ')).toBe('abc')
  })

  it('「しもつり」のように姓と名をまたぐひらがな入力でも「下津 里恵(シモツ リエ)」様が当たる', () => {
    expect(hit('しもつり')).toBe(true)
    expect(hit('シモツリ')).toBe(true)
    expect(hit('しもつ りえ')).toBe(true)
    expect(hit('しもつ　りえ')).toBe(true)
    expect(hit('もつり')).toBe(true)   // 途中からの部分一致
    expect(hit('りえ')).toBe(true)     // 名のみ
    expect(hit('しも')).toBe(true)
  })

  it('漢字は空白を無視した部分一致(「下津里」→「下津 里恵」)', () => {
    expect(hit('下津')).toBe(true)
    expect(hit('下津里')).toBe(true)
    expect(hit('下津 里')).toBe(true)
    expect(hit('津里恵')).toBe(true)
    expect(hit('里恵')).toBe(true)
  })

  it('関係ない入力は当たらない', () => {
    expect(hit('さとう')).toBe(false)
    expect(hit('佐藤')).toBe(false)
    expect(hit('')).toBe(false)
    expect(hit('   ')).toBe(false)
  })

  it('ひらがなのみの入力はフリガナだけを見る(漢字名に含まれる偶然のひらがなに当たらない)', () => {
    // 名前「熊谷 まりあ」・フリガナ「クマガイ マリア」: 「あ」はフリガナの末尾に含まれるので当たるが、
    // フリガナ側に無い文字で名前の「ま」だけに当たることはない。
    expect(customerNameMatches('熊谷 まりあ', 'クマガイ マリア', 'まりあ')).toBe(true)
    expect(customerNameMatches('山田 かな', 'ヤマダ ハナ', 'かな')).toBe(false) // 名前には「かな」があるがフリガナには無い
  })

  it('フリガナ未登録の顧客は、ひらがな入力のときだけ名前を見る', () => {
    expect(customerNameMatches('山田 かな', null, 'かな')).toBe(true)
    expect(customerNameMatches('山田 太郎', null, 'たろう')).toBe(false)
  })

  it('順位: 先頭一致(0) < 途中一致(1) < 不一致(null)', () => {
    expect(customerNameMatchRank('下津 里恵', 'シモツ リエ', 'しもつ')).toBe(0)
    expect(customerNameMatchRank('下津 里恵', 'シモツ リエ', 'もつり')).toBe(1)
    expect(customerNameMatchRank('下津 里恵', 'シモツ リエ', 'ゆうこ')).toBeNull()
    expect(customerNameMatchRank('下津 里恵', 'シモツ リエ', '下津')).toBe(0)
    expect(customerNameMatchRank('下津 里恵', 'シモツ リエ', '里恵')).toBe(1)
  })
})
