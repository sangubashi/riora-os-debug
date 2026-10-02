/**
 * contractTemplates.ts — 契約書・申込書の文言(2026-10-02ユーザー指定・逐語)。
 *
 * 画面(A4プレビュー)とPDFの両方がこの定数だけを参照する。文言を勝手に変更・要約・言い換えしないこと。
 */
import type { ContractDocumentType } from './contractTypes'

export interface ContractTemplate {
  title: string
  intro: string
  /** 「※」で始まる注意書き(1項目=1段落)。 */
  notes: string[]
}

export const CONTRACT_TEMPLATES: Record<ContractDocumentType, ContractTemplate> = {
  subscription: {
    title: 'サブスクリプション申込書',
    intro: '下記の通り、サブスクリプションを申し込みます。',
    notes: [
      '※お申し込みいただいたコースは、最低3ヶ月間は継続していただくものとします。期間中の変更・キャンセルはいたしかねます。',
      '※ご来店いただけない場合、コースの繰り越しはいたしかねます。',
      '※商品付きのコースの場合は、店頭で商品をお渡しいたします。ご来店が難しい場合は、ご自宅へ着払いでの発送も可能ですので、お気軽にお申し付けください。',
      '※サブスクリプション停止をご希望の場合は、お客様ご自身で操作せず、必ずサロンまでご連絡をお願いいたします。',
    ],
  },
  ticket: {
    title: '回数券購入申込書',
    intro: '下記の通り、回数券の購入を申し込みます。',
    notes: [
      '※お申し込みいただいたコースの変更・キャンセル・返金はお受けできませんので、あらかじめご了承ください。',
    ],
  },
}

/** 表の見出し(原文は「コース名　数量　金額　備考」。PDFには単価も含める指示のため単価列を追加)。 */
export const CONTRACT_TABLE_HEADERS = ['コース名', '数量', '単価', '金額', '備考'] as const
export const CONTRACT_TOTAL_LABEL = '合計金額'

export const CONTRACT_SALON = {
  name:    'Salon Riora',
  address: '東京都中央区新富1丁目15-4 CGA 新富',
  phone:   '070-9458-4869',
} as const

export const CONTRACT_DOCUMENT_TYPE_LABEL: Record<ContractDocumentType, string> = {
  subscription: CONTRACT_TEMPLATES.subscription.title,
  ticket:       CONTRACT_TEMPLATES.ticket.title,
}
