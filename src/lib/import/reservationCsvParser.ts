/**
 * reservationCsvParser.ts — 予約CSV(SalonBoard「予約一覧」エクスポート)パーサー
 *
 * 設計根拠: docs/design/RESERVATION_IMPORT_V1.md(RES-2)・RES-3確定事項・
 *   RES-CSV-VERIFY実CSV調査(予約一覧_20260702125005.csv, 59列)
 *
 * SalonBoardの「予約一覧」エクスポートはマージセル由来で「開始時間」「終了時間」が
 * 各2回出現する(1回目=実際の予約枠、2回目=第一来店希望日の候補枠)。本パーサーは
 * 各ヘッダー名の**最初の出現**を実際の予約枠として採用する(RES-CSV-VERIFY実データで
 * 確認済みの列位置と一致)。
 */

import { normalizeCustomerName } from './normalizer'

export interface ReservationCsvRow {
  /** 元CSVの1-based行番号(ヘッダー行を1とした実ファイル行)。 */
  lineNumber:     number
  statusRaw:      string
  staffNameRaw:   string
  visitDate:      string   // "20260731" (YYYYMMDD)
  startTime:      string   // "1700" (HHMM)
  endTime:        string   // "1830" (HHMM)
  durationMinutes: number
  /** 予約時メニュー→予約時メニューカテゴリ→会計時メニューの順でフォールバック済みの値。 */
  menuName:       string
  customerName:   string
  customerKana:   string
  totalAmount:    number
  /** 「このサロンに行くのは初めてですか？」の生値。 */
  isFirstVisitRaw: string
  notes:          string | null
}

const REQUIRED_HEADERS = [
  'ステータス', 'スタッフ名', '来店日', '開始時間', '終了時間', '所要時間',
  'お名前', '予約時合計金額',
]

/** 予約枠を特定する列。「開始時間」「終了時間」は最初の出現(第一来店希望日欄より前)を採用する。 */
const SLOT_HEADERS = new Set(['開始時間', '終了時間'])

export interface ParseReservationCsvIssue {
  lineNumber?: number
  code:        string
  message:     string
  severity:    'error' | 'warn'
}

export interface ParseReservationCsvResult {
  rows:       ReservationCsvRow[]
  totalLines: number
  issues:     ParseReservationCsvIssue[]
}

// ─── CSV全体パース(RFC4180準拠・引用符内改行/カンマ/エスケープ引用符に対応) ───
//
// RES-5.1: 旧実装はcsvText.split(/\r?\n/)で先に行分割してからparseCsvLine()で
// 引用符処理していたため、「ご要望・ご相談」「次回来店向けメモ」等の自由記述欄に
// 実際の改行が含まれる行でCSV構造が破壊されていた(予約一覧_20260626150030.csv等で
// 再現確認済み)。本実装はテキスト全体を1文字ずつ走査し、引用符の外側にある
// 改行のみをレコード区切りとして扱う。

/** CSVテキスト全体をレコード(行=フィールド配列)の配列にパースする。 */
function parseCsvRecords(text: string): string[][] {
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let inQuote = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (inQuote) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } // エスケープされたダブルクォート("")
        else inQuote = false                            // 引用符閉じ
      } else {
        field += ch // 引用符内の改行・カンマもそのままフィールドへ含める
      }
      continue
    }

    if (ch === '"') {
      inQuote = true
    } else if (ch === ',') {
      record.push(field.trim())
      field = ''
    } else if (ch === '\r') {
      // 無視(直後の\nでレコード区切りとして処理する)
    } else if (ch === '\n') {
      record.push(field.trim())
      field = ''
      records.push(record)
      record = []
    } else {
      field += ch
    }
  }
  // 末尾に改行が無いファイルの最終フィールド/レコードを回収する
  if (field.length > 0 || record.length > 0) {
    record.push(field.trim())
    records.push(record)
  }

  // 完全な空行(旧実装のcsvText.split(...).filter(l => l.trim() !== '')と同じ扱い)は除外する
  return records.filter(r => !(r.length === 1 && r[0] === ''))
}

function parseNumber(s: string): number {
  if (s.trim() === '') return 0
  const n = Number(s.replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** ヘッダー名 → 列インデックスのマップを作る。重複ヘッダーは最初の出現を採用する。 */
function buildHeaderIndex(headers: string[]): Map<string, number> {
  const map = new Map<string, number>()
  headers.forEach((h, i) => {
    if (!map.has(h)) map.set(h, i)
  })
  return map
}

export function parseReservationCsv(csvText: string): ParseReservationCsvResult {
  const records = parseCsvRecords(csvText)
  const issues:  ParseReservationCsvIssue[] = []
  const rows:    ReservationCsvRow[] = []

  if (records.length < 2) {
    return {
      rows, totalLines: records.length,
      issues: [{ code: 'empty_csv', message: 'CSVが空またはヘッダーのみです', severity: 'error' }],
    }
  }

  const headers = records[0]
  const headerIndex = buildHeaderIndex(headers)

  const missing = REQUIRED_HEADERS.filter(h => !headerIndex.has(h))
  if (missing.length > 0) {
    issues.push({
      code: 'missing_required_columns',
      message: `必須列が見つかりません: ${missing.join(', ')}`, severity: 'error',
    })
    return { rows, totalLines: records.length - 1, issues }
  }

  const idx = (name: string): number => headerIndex.get(name) as number
  // 予約時メニューカテゴリ・会計時メニューはフォールバック専用(必須列ではない)。
  const menuIdx         = idx('予約時メニュー')
  const menuCategoryIdx = headerIndex.get('予約時メニューカテゴリ')
  const checkoutMenuIdx = headerIndex.get('会計時メニュー')
  const notesIdx        = headerIndex.get('予約時ご要望') ?? headerIndex.get('ご要望・ご相談')
  const kanaIdx          = headerIndex.get('フリガナ')

  for (let i = 1; i < records.length; i++) {
    const values = records[i]
    const get = (name: string): string => (values[idx(name)] ?? '').trim()

    const statusRaw    = get('ステータス')
    const staffNameRaw = get('スタッフ名')
    const visitDate    = get('来店日')
    const startTime    = get('開始時間')
    const endTime      = get('終了時間')
    const durationRaw  = get('所要時間')
    const customerName = get('お名前')

    if (!statusRaw || !staffNameRaw || !visitDate || !customerName) {
      issues.push({
        lineNumber: i + 1, code: 'missing_field',
        message: `行${i + 1}: ステータス・スタッフ名・来店日・お名前のいずれかが空欄のためスキップ`,
        severity: 'error',
      })
      continue
    }

    const menuName =
      (menuIdx !== undefined && values[menuIdx]?.trim()) ||
      (menuCategoryIdx !== undefined && values[menuCategoryIdx]?.trim()) ||
      (checkoutMenuIdx !== undefined && values[checkoutMenuIdx]?.trim()) ||
      '未定'

    rows.push({
      lineNumber:      i + 1,
      statusRaw,
      staffNameRaw,
      visitDate,
      startTime,
      endTime,
      durationMinutes: parseNumber(durationRaw),
      menuName,
      customerName:    normalizeCustomerName(customerName),
      customerKana:    kanaIdx !== undefined ? (values[kanaIdx] ?? '').trim() : '',
      totalAmount:     parseNumber(get('予約時合計金額')),
      isFirstVisitRaw: get('このサロンに行くのは初めてですか？'),
      notes:           notesIdx !== undefined ? (values[notesIdx]?.trim() || null) : null,
    })
  }

  return { rows, totalLines: records.length - 1, issues }
}

/** 「来店日」(YYYYMMDD)+「開始時間/終了時間」(HHMM)をJST timestamptz(ISO文字列)へ結合する。 */
export function toIsoJst(dateStr: string, timeStr: string): string | null {
  const dm = dateStr.trim().match(/^(\d{4})(\d{2})(\d{2})$/)
  const tm = timeStr.trim().match(/^(\d{1,2})(\d{2})$/)
  if (!dm || !tm) return null
  const [, y, mo, day] = dm
  const [, h, mi] = tm
  return `${y}-${mo}-${day}T${h.padStart(2, '0')}:${mi}:00+09:00`
}

/** CSV列46「このサロンに行くのは初めてですか？」→ is_new_customer(RES-3確定マッピング)。 */
export function mapIsFirstVisit(raw: string): boolean {
  return raw.trim() === 'はい、初めてです'
}
