/**
 * normalizer.ts  — 文字列正規化ユーティリティ
 *
 * 全角→半角・スペース除去・別名辞書対応
 */

// ─── 全角→半角 ────────────────────────────────────────────────────────────────

export function toHalfWidth(s: string): string {
  return s
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c =>
      String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/　/g, ' ')
    .replace(/！/g, '!').replace(/？/g, '?')
}

// ─── スペース正規化 ───────────────────────────────────────────────────────────

export function normalizeSpaces(s: string): string {
  return s.trim().replace(/\s+/g, ' ')
}

// ─── 半角カナ→全角カナ(汎用Unicode変換・業務固有の辞書ではない) ────────────────────
//
// CSV出力元(POS/旧システム)によっては半角カタカナ(U+FF61-FF9F)で氏名・担当者名を
// 出力する場合があり、正規表現の全角半角統一(toHalfWidth)だけでは救済できない
// (toHalfWidthは全角ASCII→半角ASCIIのみを扱う・対象範囲が異なる)。
// 濁点(ﾞ)/半濁点(ﾟ)の合成を含む標準的なUnicode変換であり、店舗固有の別名辞書ではない。

const HALF_TO_FULL_KATAKANA: Record<string, string> = {
  'ｦ': 'ヲ', 'ｧ': 'ァ', 'ｨ': 'ィ', 'ｩ': 'ゥ', 'ｪ': 'ェ', 'ｫ': 'ォ', 'ｬ': 'ャ', 'ｭ': 'ュ', 'ｮ': 'ョ', 'ｯ': 'ッ',
  'ｰ': 'ー', 'ｱ': 'ア', 'ｲ': 'イ', 'ｳ': 'ウ', 'ｴ': 'エ', 'ｵ': 'オ',
  'ｶ': 'カ', 'ｷ': 'キ', 'ｸ': 'ク', 'ｹ': 'ケ', 'ｺ': 'コ',
  'ｻ': 'サ', 'ｼ': 'シ', 'ｽ': 'ス', 'ｾ': 'セ', 'ｿ': 'ソ',
  'ﾀ': 'タ', 'ﾁ': 'チ', 'ﾂ': 'ツ', 'ﾃ': 'テ', 'ﾄ': 'ト',
  'ﾅ': 'ナ', 'ﾆ': 'ニ', 'ﾇ': 'ヌ', 'ﾈ': 'ネ', 'ﾉ': 'ノ',
  'ﾊ': 'ハ', 'ﾋ': 'ヒ', 'ﾌ': 'フ', 'ﾍ': 'ヘ', 'ﾎ': 'ホ',
  'ﾏ': 'マ', 'ﾐ': 'ミ', 'ﾑ': 'ム', 'ﾒ': 'メ', 'ﾓ': 'モ',
  'ﾔ': 'ヤ', 'ﾕ': 'ユ', 'ﾖ': 'ヨ',
  'ﾗ': 'ラ', 'ﾘ': 'リ', 'ﾙ': 'ル', 'ﾚ': 'レ', 'ﾛ': 'ロ',
  'ﾜ': 'ワ', 'ﾝ': 'ン',
  '｡': '。', '｢': '「', '｣': '」', '､': '、', '･': '・',
}

const DAKUTEN_MAP: Record<string, string> = {
  'カ': 'ガ', 'キ': 'ギ', 'ク': 'グ', 'ケ': 'ゲ', 'コ': 'ゴ',
  'サ': 'ザ', 'シ': 'ジ', 'ス': 'ズ', 'セ': 'ゼ', 'ソ': 'ゾ',
  'タ': 'ダ', 'チ': 'ヂ', 'ツ': 'ヅ', 'テ': 'デ', 'ト': 'ド',
  'ハ': 'バ', 'ヒ': 'ビ', 'フ': 'ブ', 'ヘ': 'ベ', 'ホ': 'ボ',
}

const HANDAKUTEN_MAP: Record<string, string> = {
  'ハ': 'パ', 'ヒ': 'ピ', 'フ': 'プ', 'ヘ': 'ペ', 'ホ': 'ポ',
}

/** 半角カタカナ(濁点・半濁点の合成含む)を全角カタカナへ変換する。半角カタカナを含まない文字列はそのまま返す。 */
export function halfWidthKatakanaToFullWidth(s: string): string {
  let result = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    const base = HALF_TO_FULL_KATAKANA[ch]
    if (!base) {
      result += ch
      continue
    }
    const next = s[i + 1]
    if (next === 'ﾞ' && DAKUTEN_MAP[base]) {
      result += DAKUTEN_MAP[base]
      i++
    } else if (next === 'ﾟ' && HANDAKUTEN_MAP[base]) {
      result += HANDAKUTEN_MAP[base]
      i++
    } else {
      result += base
    }
  }
  return result
}

// ─── 顧客名正規化 ─────────────────────────────────────────────────────────────

export function normalizeCustomerName(name: string): string {
  let n = toHalfWidth(name).trim()
  // 全角スペース・タブを半角スペースに
  n = n.replace(/[\u3000\t]+/g, ' ')
  // 連続スペースを1つに
  n = n.replace(/\s+/g, ' ')
  // 敬称除去（照合キー生成用）
  n = n.replace(/[　 ]?(様|さま|さん)$/, '')
  return n.trim()
}

/** 照合キー用（さらに厳密化：スペース全除去 + 半角カナ→全角カナ + ひらがな→カタカナ） */
export function toNameKey(name: string): string {
  let n = normalizeCustomerName(name)
  // 半角カタカナ→全角カタカナ(CSV出力元による表記揺れ対策)
  n = halfWidthKatakanaToFullWidth(n)
  // ひらがな→カタカナ
  n = n.replace(/[ぁ-ん]/g, c =>
    String.fromCharCode(c.charCodeAt(0) + 0x60))
  // スペース除去
  n = n.replace(/\s/g, '')
  return n
}

// ─── メニュー名正規化(brain_menus突合専用・menuResolver.tsが使用) ──────────────────
//
// normalizeTreatmentName()(下記)はTREATMENT_ALIAS辞書(店舗特有の別名)に依存するため
// 別店舗/別メニュー体系では機能しない。menuResolver.tsの突合精度改善(Pass C)では
// 辞書に依存しない汎用正規化(空白除去・全角半角統一・大文字小文字統一)のみを行う
// 本関数を使う(暫定ハードコード禁止の方針に合わせ、別名辞書は追加しない)。

/** メニュー名照合用の汎用正規化。前後/内部の空白を除去し、全角英数字・記号を半角化し、大文字小文字を統一する。 */
export function normalizeForMenuMatch(name: string): string {
  return toHalfWidth(name)
    .replace(/\s+/g, '')
    .toUpperCase()
}

// ─── 施術名正規化 ─────────────────────────────────────────────────────────────

/** 施術別名辞書: { 別名 → 正式名 } */
const TREATMENT_ALIAS: Record<string, string> = {
  // プレミアムエイジングケア
  'プレミアムエイジング':         'プレミアムエイジングケア',
  'プレミアムエイジングコース':   'プレミアムエイジングケア',
  'エイジングケア':               'プレミアムエイジングケア',
  'エイジング':                   'プレミアムエイジングケア',
  // ハーブピーリング
  'ハーブピール':                 'ハーブピーリング',
  'ピーリング':                   'ハーブピーリング',
  'ピール':                       'ハーブピーリング',
  // モイスチャーフェイシャル
  'モイスチャー':                 'モイスチャーフェイシャル',
  'フェイシャル':                 'モイスチャーフェイシャル',
  'モイスチャーフェイス':         'モイスチャーフェイシャル',
  // ホワイトニングケア
  'ホワイトニング':               'ホワイトニングケア',
  '美白ケア':                     'ホワイトニングケア',
  '美白':                         'ホワイトニングケア',
}

export function normalizeTreatmentName(name: string): string {
  const normalized = toHalfWidth(name).trim()
  // 完全一致チェック
  if (TREATMENT_ALIAS[normalized]) return TREATMENT_ALIAS[normalized]
  // 部分一致チェック
  for (const [alias, canonical] of Object.entries(TREATMENT_ALIAS)) {
    if (normalized.includes(alias)) return canonical
  }
  return normalized
}

/** 施術名の揺れ検出 */
export function detectTreatmentVariants(names: string[]): Map<string, string[]> {
  const canonical = new Map<string, string[]>()
  names.forEach(name => {
    const norm = normalizeTreatmentName(name)
    if (norm !== name) {
      const variants = canonical.get(norm) ?? []
      if (!variants.includes(name)) variants.push(name)
      canonical.set(norm, variants)
    }
  })
  return canonical
}

// ─── 担当名正規化 ─────────────────────────────────────────────────────────────
//
// Pass D(スタッフ名寄せ精度検証)で判明した表記揺れ:
//   - ローマ字の大文字小文字差("KAMEYAMA" / "kameyama") → toUpperCase()で統一(汎用)
//   - 半角カタカナ表記("ﾅｶﾑﾗ") → halfWidthKatakanaToFullWidth()で統一(汎用)
// 漢字の異体字(例: 外館/外舘)・ニックネーム・カナ⇔漢字⇔ローマ字の変換は
// 文字コード上の汎用正規化では救済できない(辞書が無いと判定不可能)。これらは
// brain_staff.name_aliases(画面⑥「未解決スタッフ一覧→紐付け」)で運用対応する方針とし、
// 店舗固有の別名をコードへハードコードすることはしない。

export function normalizeStaffName(name: string): string {
  return halfWidthKatakanaToFullWidth(toHalfWidth(name))
    .trim()
    .replace(/\s+/g, '')
    .replace(/(スタッフ|担当|先生)$/, '')
    .toUpperCase()
}

// ─── SalonBoard長文メニュー名 キーワード抽出 (Pass L-2) ─────────────────────────
//
// SalonBoard はメニュー名をマーケティング長文で出力する
//   例: 【春夏におすすめ！】毛穴ごっそり★脱いちご鼻！毛穴洗浄＆ヒト幹細胞導入
// brain_menus は内部短縮名を使う
//   例: 毛穴洗浄+ヒト幹19000
// この2関数は「brain_menus の治療キーワードが SalonBoard 名に含まれるか」を
// 判定するための正規化を行う。exact/normalized/partial_match の補完として
// menuResolver.ts の keyword_match ステップが使用する。

/** SalonBoard長文メニュー名をキーワード照合用に正規化する。
 *  装飾文字・括弧・価格パターン・オプション：プレフィックスを除去し大文字化する。 */
export function extractSalonBoardNormalized(name: string): string {
  return toHalfWidth(name)
    // 【...】 → 内容を保持して括弧のみ除去
    .replace(/【([^】]*)】/g, '$1')
    // オプション：/ オプション: プレフィックス除去
    .replace(/^オプション[：:]\s*/, '')
    // 価格パターン除去: \15000→\12000 / ¥19000 / 19000円
    .replace(/[\\¥]\d{3,6}(→[\\¥]\d{3,6})?/g, '')
    .replace(/\d{4,6}円?/g, '')
    // 接続詞 → スペース（結合しないよう分離）
    .replace(/[＆&・]/g, ' ')
    // 装飾文字除去
    .replace(/[★☆◎♪※♦♥◆●▲→×〇]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

/** brain_menus.name から照合キーワード配列を抽出する。
 *  末尾の価格数字を除去し、+ 区切りで分割する。2文字以上のみ返す。 */
export function extractBrainMenuKeywords(menuName: string): string[] {
  const stripped = toHalfWidth(menuName)
    .replace(/\d{4,6}$/, '') // 末尾4桁以上の数字（価格）を除去
  return stripped
    .split(/[+＋]/)
    .map(k => k.trim().toUpperCase())
    .filter(k => k.length >= 2)
}

// ─── 重複顧客検出 ─────────────────────────────────────────────────────────────

export interface DuplicateSuspect {
  names:    string[]   // 重複の可能性がある顧客名リスト
  reason:   string     // 理由
  severity: 'warn' | 'info'
}

/** 同姓同名・表記揺れによる重複候補を検出 */
export function detectDuplicateCustomers(names: string[]): DuplicateSuspect[] {
  const suspects: DuplicateSuspect[] = []
  const keyMap = new Map<string, string[]>()

  names.forEach(name => {
    const key = toNameKey(name)
    const group = keyMap.get(key) ?? []
    if (!group.includes(name)) group.push(name)
    keyMap.set(key, group)
  })

  keyMap.forEach((group, _key) => {
    if (group.length >= 2) {
      const allSame = group.every(n => n === group[0])
      suspects.push({
        names:    group,
        reason:   allSame
          ? `「${group[0]}」が${group.length}件あります`
          : `「${group.join('」「')}」は同一顧客の可能性があります`,
        severity: 'warn',
      })
    }
  })

  return suspects
}
