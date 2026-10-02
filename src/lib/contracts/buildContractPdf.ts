/**
 * buildContractPdf.ts — 契約書・申込書のA4縦PDF生成(サーバー専用、pdf-lib + fontkit)。
 *
 * 日本語は IPAex ゴシック(src/lib/contracts/fonts/ipaexg.ttf、IPAフォントライセンスv1.0、
 * 同ディレクトリにライセンス全文を同梱)を埋め込む(subset)。文言は contractTemplates.ts の
 * 定数のみを使い、ここでは言い換えない。
 *
 * 入力はサーバーが検証・マスターから再計算済みの値だけを受け取る(クライアントの金額は信用しない)。
 * 未使用行は呼び出し側(contractCalc.buildLineItems)が既に捨てているため、itemsの行だけを描く。
 */
import fs from 'node:fs'
import path from 'node:path'
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import {
  CONTRACT_SALON, CONTRACT_TABLE_HEADERS, CONTRACT_TEMPLATES, CONTRACT_TOTAL_LABEL,
} from './contractTemplates'
import type { ContractDocumentType, ContractLineItem } from './contractTypes'

export const A4_WIDTH_PT = 595.28
export const A4_HEIGHT_PT = 841.89

export interface ContractPdfInput {
  contractId:      string
  documentType:    ContractDocumentType
  /** YYYY-MM-DD */
  applicationDate: string
  name:            string
  address:         string
  phoneNumber:     string
  items:           ContractLineItem[]
  total:           number
  signaturePng:    Uint8Array
  contentHash:     string
}

let fontBytesCache: Buffer | null = null
function loadFontBytes(): Buffer {
  if (!fontBytesCache) {
    fontBytesCache = fs.readFileSync(path.join(process.cwd(), 'src/lib/contracts/fonts/ipaexg.ttf'))
  }
  return fontBytesCache
}

export function formatYen(n: number): string {
  return `${n.toLocaleString('ja-JP')}円`
}

function formatDateJa(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${y}年${m}月${d}日`
}

/** 1文字ずつ幅を測って折り返す(日本語は単語区切りが無いため文字単位)。 */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = []
  let current = ''
  for (const ch of Array.from(text)) {
    // 禁則処理: 句読点・閉じ括弧は行頭に来ないよう、はみ出しても直前の行に残す。
    const noLineStart = '。、，．）」』】！？'.includes(ch)
    if (current && !noLineStart && font.widthOfTextAtSize(current + ch, size) > maxWidth) {
      lines.push(current)
      current = ch
    } else {
      current += ch
    }
  }
  if (current || lines.length === 0) lines.push(current)
  return lines
}

const INK = rgb(0.13, 0.11, 0.09)
const MUTED = rgb(0.45, 0.4, 0.34)
const LINE = rgb(0.45, 0.4, 0.34)
const HEAD_BG = rgb(0.95, 0.92, 0.86)

export async function buildContractPdf(input: ContractPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const font = await doc.embedFont(loadFontBytes(), { subset: true })
  const signature = await doc.embedPng(input.signaturePng)

  doc.setTitle(CONTRACT_TEMPLATES[input.documentType].title)
  doc.setAuthor(CONTRACT_SALON.name)
  doc.setProducer('Riora karte contracts')

  const tpl = CONTRACT_TEMPLATES[input.documentType]
  const margin = 48
  const contentWidth = A4_WIDTH_PT - margin * 2

  let page: PDFPage = doc.addPage([A4_WIDTH_PT, A4_HEIGHT_PT])
  let y = A4_HEIGHT_PT - margin

  const ensure = (needed: number) => {
    if (y - needed < margin) {
      page = doc.addPage([A4_WIDTH_PT, A4_HEIGHT_PT])
      y = A4_HEIGHT_PT - margin
    }
  }
  const text = (s: string, x: number, size: number, color = INK) => {
    page.drawText(s, { x, y: y - size, size, font, color })
  }
  const centered = (s: string, size: number) => {
    const w = font.widthOfTextAtSize(s, size)
    page.drawText(s, { x: (A4_WIDTH_PT - w) / 2, y: y - size, size, font, color: INK })
  }

  // タイトル
  centered(tpl.title, 20)
  y -= 20 + 22

  // 本文(導入)
  text(tpl.intro, margin, 11)
  y -= 11 + 16

  // コース表
  const colW = [190, 38, 72, 82, contentWidth - 190 - 38 - 72 - 82]
  const colX = colW.reduce<number[]>((acc, w, i) => { acc.push(i === 0 ? margin : acc[i - 1] + colW[i - 1]); return acc }, [])
  const pad = 5

  const headerH = 22
  ensure(headerH)
  page.drawRectangle({ x: margin, y: y - headerH, width: contentWidth, height: headerH, color: HEAD_BG, borderColor: LINE, borderWidth: 0.7 })
  CONTRACT_TABLE_HEADERS.forEach((h, i) => {
    const isNum = i >= 1 && i <= 3
    const w = font.widthOfTextAtSize(h, 10)
    const x = isNum ? colX[i] + colW[i] - pad - w : colX[i] + pad
    page.drawText(h, { x, y: y - 15, size: 10, font, color: INK })
  })
  y -= headerH

  for (const item of input.items) {
    const nameLines = wrapText(item.course_name, font, 10, colW[0] - pad * 2)
    const noteLines = wrapText(item.note, font, 9, colW[4] - pad * 2)
    const rowH = Math.max(nameLines.length * 13, noteLines.length * 12, 13) + 12
    ensure(rowH)
    page.drawRectangle({ x: margin, y: y - rowH, width: contentWidth, height: rowH, borderColor: LINE, borderWidth: 0.7 })
    for (let i = 1; i < colX.length; i++) {
      page.drawLine({ start: { x: colX[i], y }, end: { x: colX[i], y: y - rowH }, thickness: 0.7, color: LINE })
    }
    nameLines.forEach((l, k) => page.drawText(l, { x: colX[0] + pad, y: y - 16 - k * 13, size: 10, font, color: INK }))
    const right = (s: string, i: number) => {
      const w = font.widthOfTextAtSize(s, 10)
      page.drawText(s, { x: colX[i] + colW[i] - pad - w, y: y - 16, size: 10, font, color: INK })
    }
    right(String(item.quantity), 1)
    right(formatYen(item.unit_price), 2)
    right(formatYen(item.amount), 3)
    noteLines.forEach((l, k) => { if (l) page.drawText(l, { x: colX[4] + pad, y: y - 15 - k * 12, size: 9, font, color: INK }) })
    y -= rowH
  }

  // 合計金額
  const totalH = 26
  ensure(totalH)
  page.drawRectangle({ x: margin, y: y - totalH, width: contentWidth, height: totalH, color: HEAD_BG, borderColor: LINE, borderWidth: 0.7 })
  page.drawText(CONTRACT_TOTAL_LABEL, { x: colX[0] + pad, y: y - 17, size: 11, font, color: INK })
  const totalStr = formatYen(input.total)
  const totalW = font.widthOfTextAtSize(totalStr, 12)
  page.drawText(totalStr, { x: margin + contentWidth - pad - totalW, y: y - 18, size: 12, font, color: INK })
  y -= totalH + 16

  // 注意書き
  for (const note of tpl.notes) {
    const lines = wrapText(note, font, 9.5, contentWidth)
    ensure(lines.length * 13 + 6)
    lines.forEach((l, k) => page.drawText(l, { x: margin, y: y - 9.5 - k * 13, size: 9.5, font, color: INK }))
    y -= lines.length * 13 + 6
  }
  y -= 8

  // 申込日・氏名・住所・電話番号
  ensure(100)
  text(`申込日　${formatDateJa(input.applicationDate)}`, margin, 11)
  y -= 11 + 12
  text(`氏名：${input.name}`, margin, 11)
  y -= 11 + 12
  const addrLines = wrapText(`住所：${input.address}`, font, 11, contentWidth)
  addrLines.forEach((l, k) => page.drawText(l, { x: margin, y: y - 11 - k * 15, size: 11, font, color: INK }))
  y -= addrLines.length * 15 + 4
  text(`電話番号：${input.phoneNumber}`, margin, 11)
  y -= 11 + 14

  // 署名
  const sigBoxW = 220
  const sigBoxH = 72
  ensure(sigBoxH + 70)
  text('署名：', margin, 11)
  const sigX = margin + 40
  page.drawRectangle({ x: sigX, y: y - sigBoxH, width: sigBoxW, height: sigBoxH, borderColor: LINE, borderWidth: 0.5 })
  const scale = Math.min((sigBoxW - 8) / signature.width, (sigBoxH - 8) / signature.height, 1)
  const sw = signature.width * scale
  const sh = signature.height * scale
  page.drawImage(signature, { x: sigX + (sigBoxW - sw) / 2, y: y - sigBoxH + (sigBoxH - sh) / 2, width: sw, height: sh })
  y -= sigBoxH + 18

  // 店舗情報
  text(CONTRACT_SALON.name, margin, 12)
  y -= 12 + 6
  text(CONTRACT_SALON.address, margin, 10)
  y -= 10 + 5
  text(CONTRACT_SALON.phone, margin, 10)

  // 文書ID・内容ハッシュ(改ざん確認用。全ページ最下部の小さな脚注)
  for (const p of doc.getPages()) {
    p.drawText(`文書ID：${input.contractId}　内容ハッシュ：${input.contentHash.slice(0, 16)}`, {
      x: margin, y: 24, size: 7, font, color: MUTED,
    })
  }

  return doc.save()
}
