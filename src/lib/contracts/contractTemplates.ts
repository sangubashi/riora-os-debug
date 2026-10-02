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

/** 表の見出し(原文どおり「コース名　数量　金額　備考」。2026-10-02の見本レイアウトに合わせ単価列は印字しない)。 */
export const CONTRACT_TABLE_HEADERS = ['コース名', '数量', '金額', '備考'] as const
export const CONTRACT_TOTAL_LABEL = '合計金額'

/**
 * 事業者情報(2026-10-02ユーザー指示で更新: 事業者・代表者を追加)。
 * 表示は「ラベル：値」の5行(contractSalonLines)。
 */
export const CONTRACT_SALON = {
  company:        '株式会社martylabo',
  name:           'Salon Riora',
  representative: '鈴木 雅子',
  address:        '東京都中央区新富1丁目15-4 CGA 新富 401',
  phone:          '070-9458-4869',
} as const

export const CONTRACT_SALON_LINES: ReadonlyArray<readonly [label: string, value: string]> = [
  ['事業者', CONTRACT_SALON.company],
  ['店舗名', CONTRACT_SALON.name],
  ['代表者', CONTRACT_SALON.representative],
  ['住所', CONTRACT_SALON.address],
  ['電話番号', CONTRACT_SALON.phone],
]

export const CONTRACT_DOCUMENT_TYPE_LABEL: Record<ContractDocumentType, string> = {
  subscription: CONTRACT_TEMPLATES.subscription.title,
  ticket:       CONTRACT_TEMPLATES.ticket.title,
}
