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

/** 照合キー用（さらに厳密化：スペース全除去 + ひらがな→カタカナ） */
export function toNameKey(name: string): string {
  let n = normalizeCustomerName(name)
  // ひらがな→カタカナ
  n = n.replace(/[ぁ-ん]/g, c =>
    String.fromCharCode(c.charCodeAt(0) + 0x60))
  // スペース除去
  n = n.replace(/\s/g, '')
  return n
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

export function normalizeStaffName(name: string): string {
  return toHalfWidth(name)
    .trim()
    .replace(/\s+/g, '')
    .replace(/(スタッフ|担当|先生)$/, '')
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
