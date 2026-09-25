/**
 * facialSchemaApiMapping.ts — brain_customer_facial_schemasのDB行 ⇄ API応答の変換。
 *
 * GET/PUT両ルートで同じ列選択・同じ変換を使うための共有モジュール
 * (src/lib/photos/photoApiClient.tsのTimelinePhoto変換と同じ「マッピングを1箇所に
 * まとめる」方針)。
 */
import { parseStrokesData, type StrokesData } from './strokeModel'

/** GET/PUT共通のSELECT列(冗長な重複を避けるため1箇所にまとめる)。
 *  photo_path(2026-09-25追加・過去来店の写真アップロード機能)はDB上のStorageパスの
 *  ままでは意味を持たないため、mapFacialSchemaRow()では返さず、呼び出し元
 *  (GET route)がsigned URLへ変換したうえでphotoUrlとして別途付与する。 */
export const FACIAL_SCHEMA_SELECT_COLUMNS =
  'id, visit_id, schema_date, template_key, strokes_data, photo_path, created_by, updated_by, created_at, updated_at'

export interface FacialSchemaRow {
  id:           string
  visit_id:     string | null
  schema_date:  string
  template_key: string
  strokes_data: unknown
  photo_path:   string | null
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
  /** 過去来店の写真アップロード機能(2026-09-25): signed URL。無ければnull(ベクター描画のみ)。 */
  photoUrl:    string | null
  createdBy:   string | null
  updatedBy:   string | null
  createdAt:   string
  updatedAt:   string
}

/**
 * DB行(snake_case)をAPI応答の形(camelCase)へ変換する。strokes_dataは防御的にパースする。
 * photoUrlは呼び出し元が別途signed URLを解決してから上書きする想定のため、ここではnullを
 * 入れておく(photo_path自体は生のStorageパスでクライアントに渡さないため、返り値には含めない)。
 */
export function mapFacialSchemaRow(row: FacialSchemaRow): FacialSchemaApiShape {
  return {
    id:          row.id,
    visitId:     row.visit_id,
    schemaDate:  row.schema_date,
    templateKey: row.template_key,
    strokesData: parseStrokesData(row.strokes_data),
    photoUrl:    null,
    createdBy:   row.created_by,
    updatedBy:   row.updated_by,
    createdAt:   row.created_at,
    updatedAt:   row.updated_at,
  }
}
