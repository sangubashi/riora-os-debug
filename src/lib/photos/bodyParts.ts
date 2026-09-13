/**
 * bodyParts.ts — 写真カルテ 部位語彙
 *
 * 設計根拠: docs/PHOTO_KARTE_UX_WIREFRAME_1.md 5節。CHECK制約はDB側に持たせない
 * 既存方針(docs/PHOTO_KARTE_DB_DESIGN_1.md 6節)のため、この語彙はアプリ側の定数として
 * 管理する。
 *
 * PHOTO_LABEL_REALIGN_1(2026-09-13): 施術ベッドで仰向けという実際の撮影スタイルに
 * 合わせ、選択肢を「正面・斜め・顎・額」の4つに絞った(小宮山仁美様の実例で、
 * 実態と合わない「左45°/右45°」の自動仮割当てが原因の表示欠落が発生したための対応。
 * 詳細はdocs/architecture/Riora_Management_Dashboard_Architecture_v2.1.mdではなく
 * 写真カルテ側の調査記録を参照)。
 *
 * 過去データ(face_left45/face_right45/cheek_left等)はDBの値を書き換えず、
 * LEGACY_BODY_PART_LABELSで表示ラベルのみ引き続き解決する(新規アップロードの
 * 選択肢には出さない)。
 */

export interface BodyPartOption {
  id: string
  label: string
}

/** 新規アップロード時に選択できる語彙(常にこの中から明示的に選ぶ・自動仮割当ては行わない)。 */
export const BODY_PART_OPTIONS: BodyPartOption[] = [
  { id: 'face_front',   label: '正面' },
  { id: 'face_oblique', label: '斜め' },
  { id: 'chin',         label: '顎' },
  { id: 'forehead',     label: '額' },
]

/**
 * 過去に選択肢として存在したが現在は選択肢から外れたID → 表示ラベルのみ。
 * face_left45/face_right45は新語彙では左右を区別しない「斜め」に統合する。
 */
const LEGACY_BODY_PART_LABELS: Record<string, string> = {
  face_left45:  '斜め',
  face_right45: '斜め',
  cheek_left:   '左頬',
  cheek_right:  '右頬',
  nose:         '鼻',
  eye_area:     '目周り',
  neck:         '首',
  other:        'その他',
}

export function bodyPartLabel(id: string): string {
  return BODY_PART_OPTIONS.find(o => o.id === id)?.label ?? LEGACY_BODY_PART_LABELS[id] ?? id
}
