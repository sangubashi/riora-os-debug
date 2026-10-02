/**
 * courseMaster.ts — 契約書・申込書専用の固定コースマスター(2026-10-02ユーザー指示)。
 *
 * brain_menus(ホットペッパー由来・必要なコースが無い/0円が多い)は使わない。
 * 将来「管理画面から変更」できるよう、参照はすべて下の getContractCourses / findContractCourse
 * 経由にする(呼び出し側は配列定数を直接importしない)。DB化する場合はこの2関数の中身を
 * 差し替えるだけでよい。保存側のline_itemsにはidではなく、保存時点のコース名・単価を
 * スナップショットする(マスターが変わっても過去の契約書は変わらない)。
 */
import type { ContractDocumentType } from './contractTypes'

export interface ContractCourse {
  id:           string
  documentType: ContractDocumentType
  name:         string
  unitPrice:    number
}

const COURSES: readonly ContractCourse[] = [
  // サブスクリプション
  { id: 'sub-hsc-basic',   documentType: 'subscription', name: 'ヒト幹細胞ベーシック',              unitPrice: 13000 },
  { id: 'sub-hsc-basic-2', documentType: 'subscription', name: 'ヒト幹細胞ベーシック 月2回',         unitPrice: 26000 },
  { id: 'sub-skin',        documentType: 'subscription', name: '選べる肌改善コース',                 unitPrice: 16000 },
  { id: 'sub-skin-cosme',  documentType: 'subscription', name: '選べる肌改善コース＋化粧品1点',      unitPrice: 26000 },
  { id: 'sub-herb-hsc',    documentType: 'subscription', name: 'ハーブピーリング＋ヒト幹細胞コース', unitPrice: 17000 },
  // 回数券
  { id: 'tkt-hsc-basic-3', documentType: 'ticket',       name: 'ヒト幹細胞ベーシック 3回',           unitPrice: 42000 },
  { id: 'tkt-hydra-hsc-3', documentType: 'ticket',       name: 'ハイドラ×ヒト幹細胞コース 3回',      unitPrice: 49900 },
  { id: 'tkt-kogao-hsc-3', documentType: 'ticket',       name: '小顔×ヒト幹細胞コース 3回',          unitPrice: 49900 },
  { id: 'tkt-nyuushi-3',   documentType: 'ticket',       name: '乳歯パーフェクト 3回',               unitPrice: 49900 },
]

export function getContractCourses(documentType: ContractDocumentType): ContractCourse[] {
  return COURSES.filter(c => c.documentType === documentType)
}

/** 書類種類に属するコースのみ返す(別種類のコースIDは拒否する)。 */
export function findContractCourse(documentType: ContractDocumentType, courseId: string): ContractCourse | null {
  return COURSES.find(c => c.id === courseId && c.documentType === documentType) ?? null
}
