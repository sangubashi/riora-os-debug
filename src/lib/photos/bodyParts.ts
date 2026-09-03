/**
 * bodyParts.ts — 写真カルテ Phase1 固定語彙(撮影ポジション込み)
 *
 * 設計根拠: docs/PHOTO_KARTE_UX_WIREFRAME_1.md 5節。
 * angleを body_part 自体に統合する(顔全体のみ3角度)。CHECK制約はDB側に持たせない
 * 既存方針(docs/PHOTO_KARTE_DB_DESIGN_1.md 6節)のため、この語彙はアプリ側の定数として
 * 管理する。将来「2部位目に角度バリエーションが広がったら列分割を検討する」という
 * 移行トリガーが同ドキュメント5-1節に明記されている。
 */

export interface BodyPartOption {
  id: string
  label: string
}

export const BODY_PART_OPTIONS: BodyPartOption[] = [
  { id: 'face_front',   label: '顔全体・正面' },
  { id: 'face_left45',  label: '顔全体・左45°' },
  { id: 'face_right45', label: '顔全体・右45°' },
  { id: 'forehead',     label: '額' },
  { id: 'cheek_left',   label: '左頬' },
  { id: 'cheek_right',  label: '右頬' },
  { id: 'nose',         label: '鼻' },
  { id: 'chin',         label: '顎' },
  { id: 'eye_area',     label: '目周り' },
  { id: 'neck',         label: '首' },
  { id: 'other',        label: 'その他' },
]

export const DEFAULT_BODY_PART = BODY_PART_OPTIONS[0].id

export function bodyPartLabel(id: string): string {
  return BODY_PART_OPTIONS.find(o => o.id === id)?.label ?? id
}
