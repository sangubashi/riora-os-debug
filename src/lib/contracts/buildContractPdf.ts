/**
 * buildContractPdf.ts — 契約書・申込書のA4縦PDF生成(サーバー専用、pdf-lib + fontkit)。
 *
 * 日本語は IPAex 明朝(本文: ipaexm.ttf)と IPAex ゴシック(見出し: ipaexg.ttf)を埋め込む(subset、
 * IPAフォントライセンスv1.0、src/lib/contracts/fonts/ にライセンス全文を同梱)。
 * ゴシック=文書タイトル・表の項目ヘッダー・署名見出し、明朝=それ以外の本文全般。文言は contractTemplates.ts の
 * 定数のみを使い、ここでは言い換えない。
 *
 * 入力はサーバーが検証・マスターから再計算済みの値だけを受け取る(クライアントの金額は信用しない)。
 *
 * レイアウト(2026-10-02ユーザー提示の見本「51544.jpg」に合わせた): 左揃えの大きなタイトル、
 * 黒罫線の4列の表(コース名/数量/金額/備考・空行を含め常に4行)で、最下段の行に「合計金額」(数量の列)と
 * 合計(金額の列)、「※」を行頭に出して2行目以降を字下げした注意書き、広い間隔の申込日(年/月/日)と
 * 氏名・住所・電話番号、下段は事業者情報の囲み枠と(右隣に)署名枠。配色は黒のみ。
 * 文書ID・内容ハッシュはPDFには表示しない(content_hashはDBに保存し改ざん確認に使う)。
 * 単価は印字しない(保存データのline_itemsには残る)。
 */
import fs from 'node:fs'
import path from 'node:path'
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import {
  CONTRACT_SALON, CONTRACT_SALON_LINES, CONTRACT_TABLE_HEADERS, CONTRACT_TEMPLATES, CONTRACT_TOTAL_LABEL,
} from './contractTemplates'
import { CONTRACT_MAX_LINES, type ContractDocumentType, type ContractLineItem } from './contractTypes'

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
  /** PDF本文には表示しない(呼び出し側の互換のため受け取るだけ)。 */
  contentHash:     string
}

const fontBytesCache = new Map<string, Buffer>()
function loadFontBytes(fileName: 'ipaexg.ttf' | 'ipaexm.ttf'): Buffer {
  let bytes = fontBytesCache.get(fileName)
  if (!bytes) {
    bytes = fs.readFileSync(path.join(process.cwd(), 'src/lib/contracts/fonts', fileName))
    fontBytesCache.set(fileName, bytes)
  }
  return bytes
}

export function formatYen(n: number): string {
  return `${n.toLocaleString('ja-JP')}円`
}

/** 1文字ずつ幅を測って折り返す(日本語は単語区切りが無いため文字単位)。先頭行だけ幅を変えられる。 */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number, firstLineWidth = maxWidth): string[] {
  return wrapOnce(text, font, size, maxWidth, firstLineWidth)
}

/**
 * wrapTextに加え、最後の行が1〜2文字だけ(「い。」のように句読点つきの短い行)になる場合は、
 * 行の幅を2文字分ずつ狭めて折り返し直し、前の行から数文字を下ろして最終行を読みやすくする(注意書き用)。
 */
export function wrapTextNoOrphan(text: string, font: PDFFont, size: number, maxWidth: number, firstLineWidth = maxWidth): string[] {
  let lines = wrapOnce(text, font, size, maxWidth, firstLineWidth)
  for (let shrink = 1; shrink <= 3 && lines.length > 1 && Array.from(lines[lines.length - 1]).length <= 2; shrink++) {
    lines = wrapOnce(text, font, size, maxWidth - size * 2 * shrink, firstLineWidth - size * 2 * shrink)
  }
  return lines
}

function wrapOnce(text: string, font: PDFFont, size: number, maxWidth: number, firstLineWidth: number): string[] {
  const lines: string[] = []
  let current = ''
  for (const ch of Array.from(text)) {
    const limit = lines.length === 0 ? firstLineWidth : maxWidth
    // 禁則処理: 句読点・閉じ括弧は行頭に来ないよう、はみ出しても直前の行に残す。
    const noLineStart = '。、，．）」』】！？'.includes(ch)
    if (current && !noLineStart && font.widthOfTextAtSize(current + ch, size) > limit) {
      lines.push(current)
      current = ch
    } else {
      current += ch
    }
  }
  if (current || lines.length === 0) lines.push(current)
  return lines
}

// 黒のみ(見本どおり)
const INK = rgb(0, 0, 0)
const RULE = 0.9

// 見本(1080px幅=A4)から読み取った配置[pt]
const TABLE_X = 58
const TABLE_W = 488
const COL_W = [210, 54, 118, 106]        // コース名 / 数量 / 金額 / 備考
const PAD_X = 9
const TITLE_X = 55
const NOTE_X = 46                         // 「※」を出す位置
const NOTE_INDENT = 12                    // 2行目以降の字下げ(※の幅)
const NOTE_RIGHT = 562
const LABEL_X = 68                        // 申込日・氏名・住所・電話番号のラベル
const VALUE_X = 140                       // 氏名・住所・電話番号の値
const BOX_X = 62
const BOX_W = 290
const SIGN_X = 372
const SIGN_W = TABLE_X + TABLE_W - SIGN_X // 表の右端にそろえる
const BOTTOM_LIMIT = 40

export async function buildContractPdf(input: ContractPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const gothic = await doc.embedFont(loadFontBytes('ipaexg.ttf'), { subset: true }) // 見出し・強調
  const font = await doc.embedFont(loadFontBytes('ipaexm.ttf'), { subset: true })   // 本文(明朝)
  const signature = await doc.embedPng(input.signaturePng)

  doc.setTitle(CONTRACT_TEMPLATES[input.documentType].title)
  doc.setAuthor(CONTRACT_SALON.company)
  doc.setProducer('Riora karte contracts')

  const tpl = CONTRACT_TEMPLATES[input.documentType]
  let page: PDFPage = doc.addPage([A4_WIDTH_PT, A4_HEIGHT_PT])
  // 以降 top は「ページ上端からの距離」(下へ増える)。pdf-libの座標(下端基準)へは H - top で変換する。
  let top = 96

  const ensure = (needed: number) => {
    if (top + needed > A4_HEIGHT_PT - BOTTOM_LIMIT) {
      page = doc.addPage([A4_WIDTH_PT, A4_HEIGHT_PT])
      top = 60
    }
  }
  /** textTop = 文字の上端のページ上端からの距離。 */
  const draw = (s: string, x: number, size: number, textTop: number, f: PDFFont = font) => {
    page.drawText(s, { x, y: A4_HEIGHT_PT - textTop - size * 0.86, size, font: f, color: INK })
  }
  const drawRight = (s: string, rightX: number, size: number, textTop: number) => {
    draw(s, rightX - font.widthOfTextAtSize(s, size), size, textTop)
  }
  const rect = (x: number, topY: number, w: number, h: number) => {
    page.drawRectangle({ x, y: A4_HEIGHT_PT - topY - h, width: w, height: h, borderColor: INK, borderWidth: RULE })
  }
  const vline = (x: number, topY: number, h: number) => {
    page.drawLine({ start: { x, y: A4_HEIGHT_PT - topY }, end: { x, y: A4_HEIGHT_PT - topY - h }, thickness: RULE, color: INK })
  }

  // ── タイトル・導入文(左揃え) ──
  draw(tpl.title, TITLE_X, 22, top, gothic)
  top += 22 + 39
  draw(tpl.intro, TABLE_X + 1, 10, top)
  top += 10 + 15

  // ── 表: ヘッダ行 + 本文4行(空行を含む) + 合計の行 ──
  const colX = COL_W.reduce<number[]>((acc, w, i) => { acc.push(i === 0 ? TABLE_X : acc[i - 1] + COL_W[i - 1]); return acc }, [])
  const colRight = (i: number) => colX[i] + COL_W[i]

  const headerH = 25
  ensure(headerH)
  rect(TABLE_X, top, TABLE_W, headerH)
  for (let i = 1; i < colX.length; i++) vline(colX[i], top, headerH)
  CONTRACT_TABLE_HEADERS.forEach((h, i) => draw(h, colX[i] + PAD_X, 10, top + (headerH - 10) / 2, gothic))
  top += headerH

  for (let r = 0; r < CONTRACT_MAX_LINES; r++) {
    const item = input.items[r]
    const nameLines = item ? wrapText(item.course_name, font, 10, COL_W[0] - PAD_X * 2) : []
    const noteLines = item ? wrapText(item.note, font, 9, COL_W[3] - PAD_X * 2) : []
    const rowH = Math.max(30, nameLines.length * 13 + 16, noteLines.length * 11.5 + 16)
    ensure(rowH)
    rect(TABLE_X, top, TABLE_W, rowH)
    for (let i = 1; i < colX.length; i++) vline(colX[i], top, rowH)
    if (item) {
      const single = nameLines.length === 1 && noteLines.length <= 1
      nameLines.forEach((l, k) => draw(l, colX[0] + PAD_X, 10, single ? top + (rowH - 10) / 2 : top + 8 + k * 13))
      draw(String(item.quantity), colX[1] + PAD_X, 10, single ? top + (rowH - 10) / 2 : top + 8)
      drawRight(formatYen(item.amount), colRight(2) - PAD_X, 10, single ? top + (rowH - 10) / 2 : top + 8)
      noteLines.forEach((l, k) => { if (l) draw(l, colX[3] + PAD_X, 9, single ? top + (rowH - 9) / 2 : top + 8 + k * 11.5) })
    }
    top += rowH
  }

  // 合計の行: 「合計金額」は数量の列、合計は金額の列(見本どおり)
  const totalH = 30
  ensure(totalH)
  rect(TABLE_X, top, TABLE_W, totalH)
  for (let i = 1; i < colX.length; i++) vline(colX[i], top, totalH)
  draw(CONTRACT_TOTAL_LABEL, colX[1] + PAD_X - 2, 9, top + (totalH - 9) / 2)
  drawRight(formatYen(input.total), colRight(2) - PAD_X, 11, top + (totalH - 11) / 2)
  top += totalH + 30

  // ── 注意書き(「※」を行頭に出し、2行目以降を字下げ) ──
  for (const note of tpl.notes) {
    const lines = wrapTextNoOrphan(note, font, 10.5, NOTE_RIGHT - (NOTE_X + NOTE_INDENT), NOTE_RIGHT - NOTE_X)
    ensure(lines.length * 13.5)
    lines.forEach((l, k) => draw(l, k === 0 ? NOTE_X : NOTE_X + NOTE_INDENT, 10.5, top + k * 13.5))
    top += lines.length * 13.5 + 9
  }
  top += 16

  // ── 申込日(氏名・住所の値と同じ位置から、年・月・日を詰めて続ける) ──
  ensure(130)
  const [y, m, d] = input.applicationDate.split('-').map(Number)
  draw('申込日', LABEL_X, 11, top)
  let dateX = VALUE_X
  for (const [num, unit] of [[y, '年'], [m, '月'], [d, '日']] as const) {
    const numStr = String(num)
    draw(numStr, dateX, 11, top)
    dateX += font.widthOfTextAtSize(numStr, 11) + 2
    draw(unit, dateX, 11, top)
    dateX += font.widthOfTextAtSize(unit, 11) + 9
  }
  top += 31

  draw('氏名：', LABEL_X, 11, top)
  draw(input.name, VALUE_X, 11, top)
  top += 31

  draw('住所：', LABEL_X, 11, top)
  const addrLines = wrapText(input.address, font, 11, NOTE_RIGHT - VALUE_X)
  addrLines.forEach((l, k) => draw(l, VALUE_X, 11, top + k * 15))
  top += Math.max(31, addrLines.length * 15 + 16)

  draw('電話番号：', LABEL_X, 11, top)
  draw(input.phoneNumber, VALUE_X, 11, top)
  top += 30

  // ── 下段: 事業者情報の囲み枠(左) と 署名枠(右) ──
  const boxH = 99
  ensure(boxH)
  rect(BOX_X, top, BOX_W, boxH)
  CONTRACT_SALON_LINES.forEach(([label, value], k) => draw(`${label}：${value}`, BOX_X + 13, 10, top + 12 + k * 15))

  rect(SIGN_X, top, SIGN_W, boxH)
  draw('署名', SIGN_X + 9, 9, top + 8, gothic)
  const areaW = SIGN_W - 20
  const areaH = boxH - 34
  const scale = Math.min(areaW / signature.width, areaH / signature.height, 1)
  const sw = signature.width * scale
  const sh = signature.height * scale
  page.drawImage(signature, {
    x: SIGN_X + (SIGN_W - sw) / 2,
    y: A4_HEIGHT_PT - top - 26 - areaH + (areaH - sh) / 2,
    width: sw, height: sh,
  })

  return doc.save()
}
