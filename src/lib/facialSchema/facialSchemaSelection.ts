/**
 * facialSchemaSelection.ts — 顔シェーマの「撮影機会(occasion)」判定と「前回の記録」選択。
 *
 * 写真カルテ機能(src/lib/photos/comparisonSelection.ts・ghostSelection.ts)と同じ
 * 「visit_idがあれば`visit:${id}`、無ければ日付キー」という撮影機会の考え方を再利用する。
 * iPad撮影時点ではbrain_visitsが未作成(施術後にCSV取込または接客ログ保存で初めて
 * 作られる)ため、その日の記録はvisit_id=nullになる。写真機能と同じ問題への同じ対策。
 *
 * 写真機能との違い: 写真は同一撮影機会に複数枚あり得る(グルーピングが必要)のに対し、
 * 顔シェーマはDB設計(brain_customer_facial_schemas、customer_id×visit_id/schema_date
 * の部分ユニークインデックス)により1撮影機会=1行が保証されるため、グルーピング処理は
 * 不要。そのため「同一日付=UTCの日付部分」という写真機能の簡易ルール
 * (comparisonSelection.tsのoccasionKey参照)ではなく、実際にDBへ保存される
 * schema_date(JST基準の営業日)をそのままキーに使う。JST変換は
 * src/lib/photos/linkPhotosToVisit.tsの「固定+09:00オフセット、タイムゾーンDB不要」
 * という既存方針をここでも踏襲する(todayJstDateStr/toJstDateStr)。
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000

/** UTC Dateを起点に、JST(UTC+9固定)の暦日をYYYY-MM-DD文字列で返す。 */
export function toJstDateStr(date: Date): string {
  const jst = new Date(date.getTime() + JST_OFFSET_MS)
  return jst.toISOString().slice(0, 10)
}

/** 「今日」のJST暦日をYYYY-MM-DD文字列で返す。テスト容易性のため基準時刻を引数で上書きできる。 */
export function todayJstDateStr(now: Date = new Date()): string {
  return toJstDateStr(now)
}

export interface FacialSchemaRecord {
  id:          string
  visitId:     string | null
  /** JST暦日、YYYY-MM-DD(DBのdate型をそのまま文字列で受け取る想定)。 */
  schemaDate:  string
}

/** 撮影機会を一意に識別するキー。写真機能のoccasionKey()と同じ形。 */
function occasionKey(record: Pick<FacialSchemaRecord, 'visitId' | 'schemaDate'>): string {
  return record.visitId ? `visit:${record.visitId}` : `date:${record.schemaDate}`
}

/** 「現在編集中の機会」を一意に識別するキー(excludingCurrentOccasionで使う)。 */
export function currentOccasionKey(currentVisitId: string | null, todayJst: string): string {
  return currentVisitId ? `visit:${currentVisitId}` : `date:${todayJst}`
}

/** schemaDateの新しい順(降順)に並べ替えた新しい配列を返す(元配列は変更しない)。 */
export function sortRecordsDesc<T extends FacialSchemaRecord>(records: T[]): T[] {
  return [...records].sort((a, b) => b.schemaDate.localeCompare(a.schemaDate))
}

/**
 * 「現在編集中の機会」と同じ撮影機会に属するレコードを除外する。
 * src/lib/photos/ghostSelection.tsのexcludingCurrentOccasion()と同じ役割
 * (今日これから保存する/した記録自身を「前回」として誤選択しないようにする)。
 */
export function excludingCurrentOccasion<T extends FacialSchemaRecord>(
  records: T[],
  currentVisitId: string | null,
  todayJst: string
): T[] {
  const key = currentOccasionKey(currentVisitId, todayJst)
  return records.filter(r => occasionKey(r) !== key)
}

/**
 * 「前回の記録」を選ぶ。現在編集中の機会を除外した上で、最も新しい撮影機会のレコードを返す。
 * 該当が無ければnull。
 */
export function buildPreviousSchema<T extends FacialSchemaRecord>(
  records: T[],
  currentVisitId: string | null,
  todayJst: string = todayJstDateStr()
): T | null {
  const remaining = excludingCurrentOccasion(records, currentVisitId, todayJst)
  const sorted = sortRecordsDesc(remaining)
  return sorted[0] ?? null
}
