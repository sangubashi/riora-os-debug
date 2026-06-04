/**
 * salonBoardParser.ts  — SalonBoard CSV パーサー
 *
 * 設計原則:
 *   - PII（電話・メール・住所・生年月日）は最初の段階で除去
 *   - カラム名の揺れ（全半角・スペース・大文字小文字）を吸収
 *   - 不正行は skip して errors に記録（処理は止めない）
 */

import type { SalonBoardRawRow, SalonBoardColumnMap } from '@/types'
import {
  normalizeCustomerName,
  normalizeTreatmentName,
  normalizeStaffName,
} from './normalizer'

// ─── PII カラムブラックリスト ─────────────────────────────────────────────────

const PII_COLUMN_PATTERNS = [
  /電話/,
  /phone/i,
  /tel/i,
  /メール/,
  /mail/i,
  /email/i,
  /郵便/,
  /postal/i,
  /zip/i,
  /住所/,
  /address/i,
  /番地/,
  /生年月日/,
  /birthday/i,
  /birth.?date/i,
]

function isPiiColumn(colName: string): boolean {
  return PII_COLUMN_PATTERNS.some(p => p.test(colName))
}

// ─── カラム名正規化 ───────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s.trim()
    .replace(/\s+/g, '')
    .replace(/　/g, '')
    .toLowerCase()
}

// ─── カラム自動検出 ───────────────────────────────────────────────────────────

const COLUMN_ALIASES: Record<keyof SalonBoardColumnMap, string[]> = {
  customerName:  ['顧客名', '氏名', '名前', 'お客様名', 'name', 'customer'],
  visitDate:     ['来店日', '来院日', '施術日', 'visitdate', 'date'],
  sales:         ['売上', '売上金額', '合計金額', 'sales', 'amount'],
  treatment:     ['施術', 'メニュー', '施術内容', 'treatment', 'menu'],
  retailSales:   ['店販', '店販売上', '商品売上', 'retail', 'product'],
  staffName:     ['担当', '担当者', 'スタッフ', 'staff', 'therapist'],
  hasNextRebook: ['次回予約', '次回', 'rebook', 'nextrebook'],
  isDesignated:  ['指名', '指名有無', 'designated'],
  ageGroup:      ['年齢', '年代', '年齢層', 'age', 'agegroup'],
  birthMonth:    ['誕生月', '誕生日月', 'birthmonth'],
}

function detectColumnMap(headers: string[]): SalonBoardColumnMap {
  const map: SalonBoardColumnMap = {}
  headers.forEach(h => {
    const norm = normalize(h)
    ;(Object.entries(COLUMN_ALIASES) as [keyof SalonBoardColumnMap, string[]][])
      .forEach(([field, aliases]) => {
        if (map[field]) return  // 既にマップ済み
        if (aliases.some(a => norm.includes(normalize(a)))) {
          map[field] = h
        }
      })
  })
  return map
}

// ─── CSV → 行配列 ─────────────────────────────────────────────────────────────

function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuote = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuote = !inQuote
      }
    } else if (ch === ',' && !inQuote) {
      result.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current.trim())
  return result
}

// ─── 値パーサー ───────────────────────────────────────────────────────────────

function parseDate(s: string): string | null {
  if (!s) return null
  // YYYY/MM/DD or YYYY-MM-DD or YYYY年MM月DD日
  const cleaned = s.replace(/年|月/g, '-').replace(/日/g, '').replace(/\//g, '-')
  const m = cleaned.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (!m) return null
  const y = m[1], mo = m[2].padStart(2,'0'), d = m[3].padStart(2,'0')
  return `${y}-${mo}-${d}`
}

function parseSales(s: string): number {
  if (!s) return 0
  const n = parseInt(s.replace(/[^\d]/g, ''), 10)
  return isNaN(n) ? 0 : n
}

function parseBoolean(s: string): boolean {
  const norm = normalize(s)
  return norm === 'あり' || norm === 'o' || norm === '○' || norm === '1'
    || norm === 'yes' || norm === 'true' || norm === '済'
}

function parseBirthMonth(s: string): number | undefined {
  if (!s) return undefined
  const m = s.match(/(\d{1,2})/)
  if (!m) return undefined
  const n = parseInt(m[1], 10)
  return n >= 1 && n <= 12 ? n : undefined
}

// ─── メインパーサー ───────────────────────────────────────────────────────────

export interface ParseCsvResult {
  rows:        SalonBoardRawRow[]
  totalLines:  number
  skippedRows: number
  errors:      string[]
}

export function parseSalonBoardCsv(
  csvText: string,
  columnMapOverride?: SalonBoardColumnMap
): ParseCsvResult {
  const lines      = csvText.split(/\r?\n/).filter(l => l.trim() !== '')
  const errors:    string[] = []
  const rows:      SalonBoardRawRow[] = []
  let   skipped    = 0

  if (lines.length < 2) {
    return { rows, totalLines: lines.length, skippedRows: 0,
      errors: ['CSVが空またはヘッダーのみです'] }
  }

  // ヘッダー解析
  const headers  = parseCsvLine(lines[0])
  const colMap   = columnMapOverride ?? detectColumnMap(headers)

  // PII カラムのインデックスを記録（デバッグ用）
  const piiCols  = headers.filter(isPiiColumn)
  if (piiCols.length > 0) {
    errors.push(`[INFO] PII カラムをスキップ: ${piiCols.join(', ')}`)
  }

  // 必須カラムチェック
  if (!colMap.customerName) errors.push('[WARN] 顧客名カラムが見つかりません')
  if (!colMap.visitDate)    errors.push('[WARN] 来店日カラムが見つかりません')

  // データ行処理
  for (let i = 1; i < lines.length; i++) {
    const values  = parseCsvLine(lines[i])
    const get     = (col?: string): string => {
      if (!col) return ''
      const idx = headers.indexOf(col)
      return idx >= 0 ? (values[idx] ?? '') : ''
    }

    const customerName = get(colMap.customerName).trim()
    const visitDateRaw = get(colMap.visitDate)
    const visitDate    = parseDate(visitDateRaw)

    if (!customerName || !visitDate) {
      skipped++
      if (i <= 5) errors.push(`[行${i+1}] 顧客名または来店日が不正: "${customerName}" / "${visitDateRaw}"`)
      continue
    }

    rows.push({
      customerName:  normalizeCustomerName(customerName),
      ageGroup:      get(colMap.ageGroup)    || undefined,
      birthMonth:    parseBirthMonth(get(colMap.birthMonth)),
      visitDate,
      sales:         parseSales(get(colMap.sales)),
      treatment:     normalizeTreatmentName(get(colMap.treatment) || '不明'),
      retailSales:   parseSales(get(colMap.retailSales)),
      staffName:     normalizeStaffName(get(colMap.staffName) || ''),
      hasNextRebook: parseBoolean(get(colMap.hasNextRebook)),
      isDesignated:  parseBoolean(get(colMap.isDesignated)),
    })
  }

  return { rows, totalLines: lines.length - 1, skippedRows: skipped, errors }
}
