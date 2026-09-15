/**
 * bodyParts.ts — 写真カルテ 部位語彙
 *
 * 設計根拠: docs/PHOTO_KARTE_UX_WIREFRAME_1.md 5節。CHECK制約はDB側に持たせない
 * 既存方針(docs/PHOTO_KARTE_DB_DESIGN_1.md 6節)のため、この語彙はアプリ側の定数として
 * 管理する。
 *
 * 撮影時の角度タブ自体はiPad(ipadKarteData.tsのIPAD_KARTE_ANGLES)・お客様モード
 * (customerModeData.tsのCUSTOMER_MODE_ANGLES)がそれぞれ独立して持っており、このファイルの
 * BODY_PART_OPTIONSはそれらのUIには直接使われていない(重複管理・変更時は3箇所同時更新が必要、
 * 9節の既知リスク)。bodyPartLabel()は、IPAD_PHOTO_MANAGE(削除管理UI・PHASE
 * IPAD-PHOTO-CAPTURE-2)のように「タブに縛られず任意のbody_part値を人が読めるラベルへ解決する」
 * 用途で使う想定。
 *
 * PHOTO_LABEL_REALIGN_1(2026-09-13): 施術ベッドで仰向けという実際の撮影スタイルに
 * 合わせ、選択肢を「正面・斜め・顎・額」の4つに絞った(小宮山仁美様の実例で、
 * 実態と合わない「左45°/右45°」の自動仮割当てが原因の表示欠落が発生したための対応)。
 *
 * PHOTO_LABEL_REALIGN_2(2026-09-15): 現場の手書きメモの運用実態(正・右・左・デコ)に
 * 合わせ、「顎」を削除し「斜め」を「右」「左」に分割した(基準は「写真に写って見えている
 * 通りの右・左」)。本番データ確認時点でface_oblique/chin/foreheadの実データは0件だった
 * ため、データ移行は不要だった。
 *
 * 過去データ(face_left45/face_right45/cheek_left等、およびPHOTO_LABEL_REALIGN_2で
 * 選択肢から外れたface_oblique/chin)はDBの値を書き換えず、LEGACY_BODY_PART_LABELSで
 * 表示ラベルのみ引き続き解決する(新規アップロードの選択肢には出さない)。
 */

export interface BodyPartOption {
  id: string
  label: string
}

/** 新規アップロード時に選択できる語彙(常にこの中から明示的に選ぶ・自動仮割当ては行わない)。 */
export const BODY_PART_OPTIONS: BodyPartOption[] = [
  { id: 'face_front', label: '正面' },
  { id: 'face_right', label: '右' },
  { id: 'face_left',  label: '左' },
  { id: 'forehead',   label: '額' },
]

/**
 * 過去に選択肢として存在したが現在は選択肢から外れたID → 表示ラベルのみ。
 * face_left45/face_right45は、当時の自動仮割当てが実態と合わなかった経緯
 * (PHOTO_LABEL_REALIGN_1)があるため、新語彙のface_right/face_leftへは再解釈せず
 * 引き続き「斜め」のまま残す。face_oblique/chinはPHOTO_LABEL_REALIGN_2で選択肢から
 * 外れた(該当データは現状0件)。
 */
const LEGACY_BODY_PART_LABELS: Record<string, string> = {
  face_oblique: '斜め',
  chin:         '顎',
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
