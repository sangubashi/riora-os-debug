/**
 * facialSchemaApiMapping.ts — brain_customer_facial_schemasのDB行 ⇄ API応答の変換。
 *
 * GET/PUT両ルートで同じ列選択・同じ変換を使うための共有モジュール
 * (src/lib/photos/photoApiClient.tsのTimelinePhoto変換と同じ「マッピングを1箇所に
 * まとめる」方針)。
 */
import { parseStrokesData, type StrokesData } from './strokeModel'

/** GET/PUT共通のSELECT列(冗長な重複を避けるため1箇所にまとめる)。 */
export const FACIAL_SCHEMA_SELECT_COLUMNS =
  'id, visit_id, schema_date, template_key, strokes_data, created_by, updated_by, created_at, updated_at'

export interface FacialSchemaRow {
  id:           string
  visit_id:     string | null
  schema_date:  string
  template_key: string
  strokes_data: unknown
  created_by:   string | null
  updated_by:   string | null
  created_at:   string
  updated_at:   string
}

export interface FacialSchemaApiShape {
  id:          string
  visitId:     string | null
  schemaDate:  string
  templateKey: string
  strokesData: StrokesData
  createdBy:   string | null
  updatedBy:   string | null
  createdAt:   string
  updatedAt:   string
}

/** DB行(snake_case)をAPI応答の形(camelCase)へ変換する。strokes_dataは防御的にパースする。 */
export function mapFacialSchemaRow(row: FacialSchemaRow): FacialSchemaApiShape {
  return {
    id:          row.id,
    visitId:     row.visit_id,
    schemaDate:  row.schema_date,
    templateKey: row.template_key,
    strokesData: parseStrokesData(row.strokes_data),
    createdBy:   row.created_by,
    updatedBy:   row.updated_by,
    createdAt:   row.created_at,
    updatedAt:   row.updated_at,
  }
}
