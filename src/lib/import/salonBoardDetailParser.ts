/**
 * salonBoardDetailParser.ts — SalonBoard「売上明細」CSV（1行=1明細項目）パーサー
 *
 * brain_*方針確定(2026-06-20)後もパース・会計ID集約ロジックはスキーマ非依存のため
 * そのまま採用する。保存先(brain_customers/brain_visits)へのマッピングは
 * src/lib/import/csvImportPipeline.ts が担う。
 * 設計根拠: docs/architecture/SalonBoard_CSV_Import_Implementation_Architecture_v1.0.md §2/§3
 *
 * 既存 salonBoardParser.ts は「1行=1来店」の集計済みフォーマットを前提にしており、
 * 実際の売上明細CSV（会計IDで複数行が1来店にまとまる形式）は読み込めない。
 * そのため別形式専用のパーサー+集約ロジックとして新設する。
 */

import { normalizeCustomerName, toHalfWidth } from './normalizer'

export interface SalonBoardDetailRow {
  /** 元CSVの1-based行番号(ヘッダー行を1とした実ファイル行)。UIのrowNumber表示に使う。 */
  lineNumber:      number
  checkoutDate:    string
  checkoutTime:    string
  checkoutId:      string
  checkoutType:    string
  category:        string
  genre:           string
  subCategory:     string
  itemName:        string
  unitPrice:       number
  priceType:       string
  quantity:        number
  amount:          number
  staffNameRaw:    string
  isDesignatedRaw: string
  customerName:    string
  customerNumber:  string
  customerKana:    string
  bookingChannel:  string
  gender:          string
  newOrRepeat:     string
}

export interface SalonBoardCheckoutAggregate {
  checkoutId:      string
  /** 集約元の代表行番号(会計ID内の先頭行)。会計内整合性エラーが無ければ必ず付与される。 */
  lineNumber:      number
  customerName:    string
  customerNumber:  string
  customerKana:    string
  gender:          string
  visitDateTime:   string
  staffNameRaw:    string
  isDesignated:    boolean
  bookingChannel:  string
  isNewCustomer:   boolean
  menuName:        string
  netServiceSales: number
  retailSales:     number
  discountTotal:   number
  optionNames:     string[]
  retailNames:     string[]
  serviceNames:    string[]
  lineItemCount:   number
}

export interface CheckoutIssue {
  checkoutId: string
  code:       string
  message:    string
  severity:   'error' | 'warn' | 'info'
  /** 集約失敗(menu_count_anomaly等)で個々の行番号を特定できない場合は省略される。 */
  lineNumber?: number
}

const HEADER_MAP: Record<string, keyof SalonBoardDetailRow> = {
  '会計日':     'checkoutDate',
  '会計時間':   'checkoutTime',
  '会計ID':     'checkoutId',
  '会計区分':   'checkoutType',
  '区分':       'category',
  'ジャンル':   'genre',
  'カテゴリ':   'subCategory',
  'メニュー・店販・割引・サービス・オプション': 'itemName',
  '単価':       'unitPrice',
  '単価区分':   'priceType',
  '個数':       'quantity',
  '金額':       'amount',
  'スタッフ':   'staffNameRaw',
  '指名':       'isDesignatedRaw',
  'お客様名':   'customerName',
  'お客様番号': 'customerNumber',
  'お客様名（フリガナ）': 'customerKana',
  '予約経路':   'bookingChannel',
  '性別':       'gender',
  '新規再来':   'newOrRepeat',
}

const NUMERIC_FIELDS = new Set<keyof SalonBoardDetailRow>(['unitPrice', 'quantity', 'amount'])
const REQUIRED_HEADERS = ['会計ID', '会計日', 'お客様名', 'スタッフ', '区分', '金額']
// 実SalonBoard「売上明細」出力は区分=施術/店販/その他のみで、メニュー/オプション/割引/サービスは
// 出現しない(2026-06-22 実データ136行で確認)。デモ生成CSV(test-data/csv-import)向けの旧区分も
// 後方互換のため残す。
const KNOWN_CATEGORIES = new Set(['メニュー', 'オプション', '店販', '割引', 'サービス', '施術', 'その他'])
const SERVICE_CATEGORIES = new Set(['メニュー', 'オプション', '割引', 'サービス', '施術', 'その他'])
const TREATMENT_CATEGORIES = new Set(['施術', 'メニュー', 'オプション', 'サービス'])
// 実SalonBoard売上明細は会計区分="会計"で出力される(デモ生成CSVは"通常")。
// いずれも正常値として扱い、それ以外(取消等)のみ警告対象にする。
const NORMAL_CHECKOUT_TYPES = new Set(['通常', '会計'])

/**
 * CSVImportSecurityArchitecture.md §1のDROP分類列(別名含む)。HEADER_MAPに無いCSV列のうち
 * この集合に一致する列名は「既知のPII列を意図的に読み捨てた」droppedColumnsとして報告し、
 * それ以外(未知列)はunknownColumnsとして報告する(分類されていない列は既定DROPだが、
 * 運用者が気付けるよう区別して表示する)。
 */
const DROP_COLUMN_ALIASES = new Set([
  '電話番号', '携帯電話番号', '携帯TEL', 'TEL', '連絡先',
  'メールアドレス', 'メール',
  '郵便番号', '〒',
  '建物名', 'マンション名', '部屋番号', '住所',
  '生年月日', '誕生日',
  'メモ', '備考', 'カウンセリング内容',
])

// ─── CSV行パース（salonBoardParser.tsと同様の手書きパーサー）───────────────────

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

function parseNumber(s: string): number | null {
  if (s === '') return null
  const n = Number(toHalfWidth(s).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

function toIsoJst(dateStr: string, timeStr: string): string | null {
  const d = dateStr.trim().replace(/\//g, '-')
  // 実SalonBoard売上明細は会計日="20260601"(YYYYMMDD区切り無し)、
  // 会計時間="134906"(HHMMSS区切り無し)で出力される(2026-06-22 実データで確認)。
  // ハイフン/コロン区切り形式(デモCSV)も後方互換のため両対応する。
  const dm = d.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/) ?? d.match(/^(\d{4})(\d{2})(\d{2})$/)
  const tm = timeStr.trim().match(/^(\d{1,2}):(\d{2})$/) ?? timeStr.trim().match(/^(\d{2})(\d{2})\d{0,2}$/)
  if (!dm || !tm) return null
  const [, y, mo, day] = dm
  const [, h, mi] = tm
  return `${y}-${mo.padStart(2, '0')}-${day.padStart(2, '0')}T${h.padStart(2, '0')}:${mi}:00+09:00`
}

// ─── 明細行パース ─────────────────────────────────────────────────────────────

export interface ParseDetailCsvResult {
  rows:            SalonBoardDetailRow[]
  totalLines:      number
  issues:          CheckoutIssue[]
  unknownColumns:  string[]
  droppedColumns:  string[]
}

function classifyUnmappedHeaders(headers: string[]): { unknownColumns: string[]; droppedColumns: string[] } {
  const unknownColumns: string[] = []
  const droppedColumns: string[] = []
  headers.forEach(h => {
    if (HEADER_MAP[h]) return
    if (DROP_COLUMN_ALIASES.has(h)) droppedColumns.push(h)
    else unknownColumns.push(h)
  })
  return { unknownColumns, droppedColumns }
}

export function parseSalonBoardDetailCsv(csvText: string): ParseDetailCsvResult {
  const lines  = csvText.split(/\r?\n/).filter(l => l.trim() !== '')
  const issues: CheckoutIssue[] = []
  const rows:   SalonBoardDetailRow[] = []

  if (lines.length < 2) {
    return {
      rows, totalLines: lines.length,
      issues: [{ checkoutId: '-', code: 'empty_csv', message: 'CSVが空またはヘッダーのみです', severity: 'error' }],
      unknownColumns: [], droppedColumns: [],
    }
  }

  const headers = parseCsvLine(lines[0])
  const { unknownColumns, droppedColumns } = classifyUnmappedHeaders(headers)
  const missing = REQUIRED_HEADERS.filter(h => !headers.includes(h))
  if (missing.length > 0) {
    issues.push({
      checkoutId: '-', code: 'missing_required_columns',
      message: `必須列が見つかりません: ${missing.join(', ')}`, severity: 'error',
    })
    return { rows, totalLines: lines.length - 1, issues, unknownColumns, droppedColumns }
  }

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i])
    const record: Partial<SalonBoardDetailRow> = { lineNumber: i + 1 }

    headers.forEach((h, idx) => {
      const field = HEADER_MAP[h]
      if (!field) return
      const raw = (values[idx] ?? '').trim()
      if (NUMERIC_FIELDS.has(field)) {
        const n = parseNumber(raw)
        if (n === null) {
          issues.push({
            checkoutId: record.checkoutId ?? '?', code: 'invalid_number',
            message: `行${i + 1}: ${h}が数値として解釈できません: "${raw}"`, severity: 'error',
            lineNumber: i + 1,
          })
        }
        ;(record as Record<string, unknown>)[field] = n ?? 0
      } else {
        ;(record as Record<string, unknown>)[field] = raw
      }
    })

    if (!record.checkoutId || !record.customerName) {
      issues.push({
        checkoutId: record.checkoutId ?? '?', code: 'missing_field',
        message: `行${i + 1}: 会計IDまたはお客様名が空欄のためスキップ`, severity: 'error',
        lineNumber: i + 1,
      })
      continue
    }

    rows.push(record as SalonBoardDetailRow)
  }

  return { rows, totalLines: lines.length - 1, issues, unknownColumns, droppedColumns }
}

// ─── 会計ID単位の集約 ─────────────────────────────────────────────────────────

export interface AggregateCheckoutsResult {
  aggregates: SalonBoardCheckoutAggregate[]
  issues:     CheckoutIssue[]
}

export function aggregateCheckouts(rows: SalonBoardDetailRow[]): AggregateCheckoutsResult {
  const byCheckout = new Map<string, SalonBoardDetailRow[]>()
  rows.forEach(r => {
    const group = byCheckout.get(r.checkoutId) ?? []
    group.push(r)
    byCheckout.set(r.checkoutId, group)
  })

  const aggregates: SalonBoardCheckoutAggregate[] = []
  const issues: CheckoutIssue[] = []

  byCheckout.forEach((lines, checkoutId) => {
    const customers = new Set(lines.map(l => l.customerName))
    // 割引・キャンペーン行はスタッフ列が空欄で出力されるため、空欄は無視して
    // 非空欄の値だけで不一致判定する(空欄1件+実名1件は不一致ではない)。
    const nonBlankStaffs = new Set(lines.map(l => l.staffNameRaw).filter(s => s !== ''))
    const datetimes  = new Set(lines.map(l => `${l.checkoutDate} ${l.checkoutTime}`))

    if (customers.size > 1) {
      issues.push({ checkoutId, code: 'inconsistent_customer', severity: 'error',
        message: `会計内で客情報が複数値: ${Array.from(customers).join(' / ')}` })
      return
    }
    if (nonBlankStaffs.size > 1) {
      issues.push({ checkoutId, code: 'inconsistent_staff', severity: 'error',
        message: `会計内でスタッフが複数値: ${Array.from(nonBlankStaffs).join(' / ')}` })
      return
    }
    if (datetimes.size > 1) {
      issues.push({ checkoutId, code: 'inconsistent_datetime', severity: 'error',
        message: `会計内で会計日時が複数値: ${Array.from(datetimes).join(' / ')}` })
      return
    }

    const staffNameRaw = Array.from(nonBlankStaffs)[0] ?? ''

    lines.forEach(l => {
      if (!KNOWN_CATEGORIES.has(l.category)) {
        issues.push({ checkoutId, code: 'unknown_category', severity: 'warn',
          message: `未知の区分値: "${l.category}"（金額集計から除外）` })
      }
    })

    const head = lines[0]
    const visitDateTime = toIsoJst(head.checkoutDate, head.checkoutTime)
    if (!visitDateTime) {
      issues.push({ checkoutId, code: 'invalid_datetime', severity: 'error',
        message: `会計日時が解釈できません: "${head.checkoutDate} ${head.checkoutTime}"` })
      return
    }

    if (head.checkoutType && !NORMAL_CHECKOUT_TYPES.has(head.checkoutType)) {
      issues.push({ checkoutId, code: 'unusual_checkout_type', severity: 'warn',
        message: `会計区分が想定外です: "${head.checkoutType}"` })
    }

    // 施術行(実フォーマット)に加え、メニュー/オプション/サービス(デモ生成CSVの旧区分)も
    // 「実質的な施術行」として扱う。店販のみ+割引(区分=その他)の会計を判別するための
    // カウントであり、区分='施術'だけに限定すると後方互換の旧フォーマットで誤判定する。
    const shijutsuLineCount = lines.filter(l => TREATMENT_CATEGORIES.has(l.category)).length
    const rawNetServiceSales = lines
      .filter(l => SERVICE_CATEGORIES.has(l.category))
      .reduce((sum, l) => sum + l.amount, 0)
    const rawRetailSales = lines
      .filter(l => l.category === '店販')
      .reduce((sum, l) => sum + l.amount, 0)
    // 実SalonBoard売上明細の割引行は区分='割引'ではなく区分='その他'+カテゴリ='割引'で
    // 出力される(デモ生成CSVの区分='割引'も後方互換のため両対応する)。
    const discountTotal = lines
      .filter(l => l.category === '割引' || (l.category === 'その他' && l.subCategory === '割引'))
      .reduce((sum, l) => sum + l.amount, 0)

    // 施術行が0件の会計(店販のみ)で割引が区分=その他に計上されると、施術売上が無いのに
    // netServiceSalesが負になりbrain_visits.treatment_amount>=0制約に違反する。
    // 施術行が無い会計の割引は店販に対する割引と判断し、店販側から差し引く(ユーザー承認済み方針)。
    const netServiceSales = shijutsuLineCount === 0 ? 0 : rawNetServiceSales
    const retailSales = shijutsuLineCount === 0 ? rawRetailSales + rawNetServiceSales : rawRetailSales

    // メニュー名解決用の代表行を選ぶ(Pass C: 名寄せ精度改善)。
    // 実SalonBoard売上明細は区分=施術/メニュー/オプション/サービスの行が0件/複数件ありうるため、
    // 安定して1件に決まらない。0件(店販・割引のみの会計)はmenuNameを空文字のままとし
    // (menuResolver.resolveMenuId()がフォールバック/unresolvedとして扱う)、複数件ある場合は
    // 金額が最も大きい行(=会計の主たる施術と推定できる)の品目名を代表値として使う。
    const treatmentLines = lines.filter(l => TREATMENT_CATEGORIES.has(l.category))
    const representativeMenuName = treatmentLines.length > 0
      ? treatmentLines.reduce((best, l) => (l.amount > best.amount ? l : best)).itemName
      : ''

    aggregates.push({
      checkoutId,
      lineNumber:      head.lineNumber,
      customerName:    normalizeCustomerName(head.customerName),
      customerNumber:  head.customerNumber,
      customerKana:    head.customerKana,
      gender:          head.gender,
      visitDateTime,
      staffNameRaw,
      // 実SalonBoard売上明細は"指名あり"/"指名なし"で出力される(デモ生成CSVは"あり"/"なし")。
      // "指名なし"は"あり"を含まないため、部分一致判定で両形式に対応できる。
      isDesignated:    head.isDesignatedRaw.includes('あり'),
      bookingChannel:  head.bookingChannel,
      isNewCustomer:   head.newOrRepeat === '新規',
      menuName:        representativeMenuName,
      netServiceSales,
      retailSales,
      discountTotal,
      optionNames:  lines.filter(l => l.category === 'オプション').map(l => l.itemName),
      retailNames:  lines.filter(l => l.category === '店販').map(l => l.itemName),
      serviceNames: lines.filter(l => l.category === 'サービス').map(l => l.itemName),
      lineItemCount: lines.length,
    })
  })

  return { aggregates, issues }
}
