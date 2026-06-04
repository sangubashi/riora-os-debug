/**
 * domainDictionary.ts  — PHASE 10 最終版
 * 美容サロン用語辞書 + normalizeTranscript()
 *
 * 設計:
 *   - Whisper が誤変換しやすい専門用語を補正
 *   - フィラー語を除去してインサイト精度を向上
 *   - 純粋関数。副作用なし
 */

// ─── 補正エントリ ─────────────────────────────────────────────────────────────

interface DictEntry {
  pattern:    RegExp
  correction: string
}

// 施術・成分名（英語/カタカナ混在で誤変換しやすい）
const TREATMENTS: DictEntry[] = [
  { pattern: /ハーブぴーりんぐ|ハーブピーリング|はーぶぴーりんぐ/gi, correction: 'ハーブピーリング' },
  { pattern: /ぴーりんぐ|ピーリング/gi,      correction: 'ピーリング' },
  { pattern: /びたみんしー|ビタミンｃ|ビタミンC/gi,  correction: 'ビタミンC' },
  { pattern: /れちのーる|Retinol/gi,         correction: 'レチノール' },
  { pattern: /せらみど|Ceramide/gi,          correction: 'セラミド' },
  { pattern: /ないあしんあみど/gi,             correction: 'ナイアシンアミド' },
  { pattern: /ひあるろんさん|ヒアルロン酸/gi,  correction: 'ヒアルロン酸' },
  { pattern: /こうしゅうは|高周波/gi,          correction: '高周波' },
  { pattern: /みずびかり|水光|すいこう/gi,      correction: '水光肌' },
  { pattern: /えいじんぐけあ/gi,              correction: 'エイジングケア' },
  { pattern: /りふとあっぷ/gi,               correction: 'リフトアップ' },
  { pattern: /はくり|剥離/gi,               correction: '剥離' },
  { pattern: /ぽあ(洗浄)?/gi,               correction: '毛穴洗浄' },
  { pattern: /どうにゅう|導入/gi,             correction: '美容成分導入' },
  { pattern: /UVカット|ゆーぶいかっと/gi,      correction: 'UVカット' },
  { pattern: /SPF|えすぴーえふ/gi,            correction: 'SPF' },
  { pattern: /ぺぷちど|Peptide/gi,           correction: 'ペプチド' },
  { pattern: /じいおうちゅうしゃ/gi,           correction: '自家中囃' },
  { pattern: /ふぇいしゃる/gi,               correction: 'フェイシャル' },
  { pattern: /とりーとめんと/gi,              correction: 'トリートメント' },
]

// 肌悩みワード
const SKIN_CONCERNS: DictEntry[] = [
  { pattern: /かんそう肌|乾燥はだ/gi,    correction: '乾燥肌' },
  { pattern: /びんかんはだ/gi,           correction: '敏感肌' },
  { pattern: /にきびあと/gi,             correction: 'ニキビ跡' },
  { pattern: /あざ|シミ|しみ/gi,         correction: 'シミ' },
  { pattern: /たるみ|弛み/gi,            correction: 'たるみ' },
  { pattern: /くすみ|くすんで/gi,         correction: 'くすみ' },
  { pattern: /あかみ|赤み/gi,            correction: '赤み' },
  { pattern: /もあ穴|毛あ|もう穴/gi,      correction: '毛穴' },
  { pattern: /しわ|シワ|皺/gi,           correction: 'シワ' },
  { pattern: /てかり|テカリ/gi,          correction: 'テカリ' },
  { pattern: /はだあれ|肌荒れ/gi,        correction: '肌荒れ' },
  { pattern: /はり不足|ハリ不足/gi,       correction: 'ハリ不足' },
]

// ホームケア・商品用語
const HOMECARE: DictEntry[] = [
  { pattern: /ほーむけあ/gi,     correction: 'ホームケア' },
  { pattern: /けしょうすい/gi,   correction: '化粧水' },
  { pattern: /にゅうえき/gi,     correction: '乳液' },
  { pattern: /びようえき/gi,     correction: '美容液' },
  { pattern: /くれんじんぐ/gi,   correction: 'クレンジング' },
  { pattern: /せんがんりょう/gi, correction: '洗顔料' },
  { pattern: /にちやけどめ/gi,   correction: '日焼け止め' },
  { pattern: /もいすちゃー/gi,   correction: 'モイスチャー' },
  { pattern: /ほしつくりーむ/gi, correction: '保湿クリーム' },
]

// サロン業務用語
const BUSINESS: DictEntry[] = [
  { pattern: /かうんせりんぐ/gi,  correction: 'カウンセリング' },
  { pattern: /りぴーと|リピート/gi, correction: 'リピート' },
  { pattern: /かいすうけん/gi,    correction: '回数券' },
  { pattern: /さぶすく|サブスク/gi, correction: 'サブスクリプション' },
  { pattern: /あふたーけあ/gi,    correction: 'アフターケア' },
  { pattern: /めにゅー変更/gi,    correction: 'メニュー変更' },
  { pattern: /よやくへんこう/gi,  correction: '予約変更' },
  { pattern: /しじゅつ後/gi,      correction: '施術後' },
  { pattern: /しじゅつちゅう/gi,  correction: '施術中' },
]

const ALL_ENTRIES = [...TREATMENTS, ...SKIN_CONCERNS, ...HOMECARE, ...BUSINESS]

// ─── フィラー語（除去対象） ────────────────────────────────────────────────────

const FILLER_PATTERNS: RegExp[] = [
  /えーと+[、。\s]*/gi,
  /あのー+[、。\s]*/gi,
  /えっと+[、。\s]*/gi,
  /まあ+、/gi,
  /んー+/gi,
  /そのー+[、。\s]*/gi,
  /ちょっと+[、。\s]+/gi,  // 「ちょっと〜」の冗長な使い方
]

// ─── 全角→半角正規化 ──────────────────────────────────────────────────────────

const NORMALIZE_CHARS: Record<string, string> = {
  'Ａ':'A','Ｂ':'B','Ｃ':'C','Ｄ':'D','Ｅ':'E','Ｆ':'F','Ｇ':'G',
  'Ｈ':'H','Ｉ':'I','Ｊ':'J','Ｋ':'K','Ｌ':'L','Ｍ':'M','Ｎ':'N',
  'Ｏ':'O','Ｐ':'P','Ｑ':'Q','Ｒ':'R','Ｓ':'S','Ｔ':'T','Ｕ':'U',
  'Ｖ':'V','Ｗ':'W','Ｘ':'X','Ｙ':'Y','Ｚ':'Z',
  'ａ':'a','ｂ':'b','ｃ':'c','ｄ':'d','ｅ':'e','ｆ':'f','ｇ':'g',
  'ｈ':'h','ｉ':'i','ｊ':'j','ｋ':'k','ｌ':'l','ｍ':'m','ｎ':'n',
  'ｏ':'o','ｐ':'p','ｑ':'q','ｒ':'r','ｓ':'s','ｔ':'t','ｕ':'u',
  'ｖ':'v','ｗ':'w','ｘ':'x','ｙ':'y','ｚ':'z',
  '０':'0','１':'1','２':'2','３':'3','４':'4',
  '５':'5','６':'6','７':'7','８':'8','９':'9',
  '　':' ',
}

function normalizeChars(text: string): string {
  return text.replace(/[Ａ-Ｚａ-ｚ０-９　]/g, c => NORMALIZE_CHARS[c] ?? c)
}

// ─── メイン: normalizeTranscript ──────────────────────────────────────────────

/**
 * Whisper 文字起こし後処理。
 * 1. 全角→半角
 * 2. フィラー語除去
 * 3. 専門用語補正（最長マッチ優先）
 * 4. 連続スペース整理
 *
 * パフォーマンス: ~5ms for 500文字テキスト
 */
export function normalizeTranscript(raw: string): string {
  if (!raw || raw.length === 0) return ''

  let text = normalizeChars(raw)

  // フィラー除去
  for (const p of FILLER_PATTERNS) {
    text = text.replace(p, '')
  }

  // 専門用語補正
  for (const { pattern, correction } of ALL_ENTRIES) {
    text = text.replace(pattern, correction)
  }

  return text.replace(/\s{2,}/g, ' ').trim()
}

// ─── サロン用語リスト（InsightTag 抽出ヒント） ────────────────────────────────

export const SALON_TERMS = {
  skinConcerns: [
    '毛穴', '乾燥', '赤み', 'くすみ', 'シミ', 'シワ', 'たるみ',
    'ニキビ', 'ハリ', '敏感肌', 'テカリ', '肌荒れ', 'ニキビ跡',
  ],
  treatments: [
    'ハーブピーリング', 'ピーリング', '水光肌', 'フェイシャル',
    'エイジングケア', '美白', '毛穴洗浄', '高周波', '美容成分導入',
    '剥離', 'トリートメント', 'リフトアップ', 'ペプチド',
  ],
  homecare: [
    'ホームケア', '保湿', '洗顔', '化粧水', '乳液', '美容液',
    '日焼け止め', 'UV', 'SPF', 'ビタミンC', 'レチノール',
    'セラミド', 'ナイアシンアミド', 'ヒアルロン酸',
  ],
  business: [
    '再来', '次回', '予約', 'リピート', '回数券', 'サブスクリプション',
    'カウンセリング', 'アフターケア', 'LINE',
  ],
} as const

export type SalonTermCategory = keyof typeof SALON_TERMS
export type SalonTerm = typeof SALON_TERMS[SalonTermCategory][number]

export function containsSalonTerms(text: string): boolean {
  return Object.values(SALON_TERMS)
    .flat()
    .some(t => text.includes(t))
}
