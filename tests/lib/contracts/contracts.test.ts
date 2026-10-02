import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { getContractCourses, findContractCourse } from '../../../src/lib/contracts/courseMaster'
import { CONTRACT_TEMPLATES, CONTRACT_SALON, CONTRACT_SALON_LINES } from '../../../src/lib/contracts/contractTemplates'
import {
  buildLineItems, calcLineAmount, isValidIsoDate, isValidQuantity, validateContractInput,
} from '../../../src/lib/contracts/contractCalc'
import { canonicalJson, computeContentHash, sha256Hex } from '../../../src/lib/contracts/contentHash'
import { buildContractPdf, wrapText, A4_WIDTH_PT, A4_HEIGHT_PT } from '../../../src/lib/contracts/buildContractPdf'
import type { ContractFormValues } from '../../../src/lib/contracts/contractTypes'

// 1x1 の有効なPNG
const PNG_1X1 = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'))

const baseForm = (over: Partial<ContractFormValues> = {}): ContractFormValues => ({
  documentType: 'subscription', applicationDate: '2026-10-02',
  name: '山田 花子', address: '東京都中央区新富1-1-1', phoneNumber: '090-1234-5678',
  lines: [{ courseId: 'sub-hsc-basic', quantity: 1, note: '' }], ...over,
})

describe('固定コースマスター', () => {
  it('サブスク5件・回数券4件で、指定の名称と金額どおり', () => {
    expect(getContractCourses('subscription').map(c => [c.name, c.unitPrice])).toEqual([
      ['ヒト幹細胞ベーシック', 13000], ['ヒト幹細胞ベーシック 月2回', 26000], ['選べる肌改善コース', 16000],
      ['選べる肌改善コース＋化粧品1点', 26000], ['ハーブピーリング＋ヒト幹細胞コース', 17000],
    ])
    expect(getContractCourses('ticket').map(c => [c.name, c.unitPrice])).toEqual([
      ['ヒト幹細胞ベーシック 3回', 42000], ['ハイドラ×ヒト幹細胞コース 3回', 49900],
      ['小顔×ヒト幹細胞コース 3回', 49900], ['乳歯パーフェクト 3回', 49900],
    ])
  })
  it('別の書類種類のコースIDは引けない', () => {
    expect(findContractCourse('ticket', 'sub-hsc-basic')).toBeNull()
    expect(findContractCourse('subscription', 'sub-hsc-basic')?.unitPrice).toBe(13000)
  })
})

describe('文言(逐語)', () => {
  it('サブスクリプション申込書', () => {
    const t = CONTRACT_TEMPLATES.subscription
    expect(t.title).toBe('サブスクリプション申込書')
    expect(t.intro).toBe('下記の通り、サブスクリプションを申し込みます。')
    expect(t.notes).toEqual([
      '※お申し込みいただいたコースは、最低3ヶ月間は継続していただくものとします。期間中の変更・キャンセルはいたしかねます。',
      '※ご来店いただけない場合、コースの繰り越しはいたしかねます。',
      '※商品付きのコースの場合は、店頭で商品をお渡しいたします。ご来店が難しい場合は、ご自宅へ着払いでの発送も可能ですので、お気軽にお申し付けください。',
      '※サブスクリプション停止をご希望の場合は、お客様ご自身で操作せず、必ずサロンまでご連絡をお願いいたします。',
    ])
  })
  it('回数券購入申込書と店舗情報', () => {
    const t = CONTRACT_TEMPLATES.ticket
    expect(t.title).toBe('回数券購入申込書')
    expect(t.intro).toBe('下記の通り、回数券の購入を申し込みます。')
    expect(t.notes).toEqual(['※お申し込みいただいたコースの変更・キャンセル・返金はお受けできませんので、あらかじめご了承ください。'])
    expect(CONTRACT_SALON).toEqual({
      company: '株式会社martylabo', name: 'Salon Riora', representative: '鈴木 雅子',
      address: '東京都中央区新富1丁目15-4 CGA 新富', phone: '070-9458-4869',
    })
    expect(CONTRACT_SALON_LINES.map(([l, v]) => `${l}：${v}`)).toEqual([
      '事業者：株式会社martylabo', '店舗名：Salon Riora', '代表者：鈴木 雅子',
      '住所：東京都中央区新富1丁目15-4 CGA 新富', '電話番号：070-9458-4869',
    ])
  })
})

describe('数量・金額・合計・空行', () => {
  it('金額=単価×数量、合計は全行の和', () => {
    expect(calcLineAmount(13000, 3)).toBe(39000)
    const r = buildLineItems('subscription', [
      { courseId: 'sub-hsc-basic', quantity: 2, note: '' },
      { courseId: 'sub-skin', quantity: 3, note: '  初回 ' },
    ])
    expect(r.ok && r.items).toEqual([
      { course_name: 'ヒト幹細胞ベーシック', unit_price: 13000, quantity: 2, amount: 26000, note: '' },
      { course_name: '選べる肌改善コース', unit_price: 16000, quantity: 3, amount: 48000, note: '初回' },
    ])
    expect(r.ok && r.total).toBe(74000)
  })
  it('未使用行(コース未選択・備考なし)は捨てる', () => {
    const r = buildLineItems('ticket', [
      { courseId: null, quantity: 1, note: '' },
      { courseId: 'tkt-hsc-basic-3', quantity: 1, note: '' },
      { courseId: null, quantity: null, note: '' },
    ])
    expect(r.ok && r.items.length).toBe(1)
  })
  it('コース未選択の行は、数量が残っていても検証・合計から完全に除外される', () => {
    const r = buildLineItems('subscription', [
      { courseId: null, quantity: 5, note: '' },
      { courseId: 'sub-skin', quantity: 2, note: '' },
      { courseId: null, quantity: 99, note: '' },
    ])
    expect(r.ok && r.items.length).toBe(1)
    expect(r.ok && r.total).toBe(32000)
    // 数量が不正でもコース未選択の行なら無視される(エラーにならない)
    expect(buildLineItems('subscription', [
      { courseId: null, quantity: 0, note: '' },
      { courseId: 'sub-skin', quantity: 1, note: '' },
    ]).ok).toBe(true)
  })
  it('数量は1〜99の整数のみ', () => {
    for (const q of [0, 100, 1.5, -1, null]) {
      expect(buildLineItems('subscription', [{ courseId: 'sub-skin', quantity: q as number, note: '' }])).toEqual({ ok: false, error: 'invalid_quantity' })
    }
    expect(isValidQuantity(1)).toBe(true)
    expect(isValidQuantity(99)).toBe(true)
  })
  it('5行以上・全行空・備考だけの行・別種類のコースは拒否', () => {
    const l = { courseId: 'sub-skin', quantity: 1, note: '' }
    expect(buildLineItems('subscription', [l, l, l, l, l])).toEqual({ ok: false, error: 'too_many_lines' })
    expect(buildLineItems('subscription', [{ courseId: null, quantity: null, note: '' }])).toEqual({ ok: false, error: 'no_lines' })
    expect(buildLineItems('subscription', [{ courseId: null, quantity: 1, note: 'メモ' }])).toEqual({ ok: false, error: 'course_required' })
    expect(buildLineItems('ticket', [{ courseId: 'sub-skin', quantity: 1, note: '' }])).toEqual({ ok: false, error: 'unknown_course' })
  })
  it('4行まで受け付ける', () => {
    const l = { courseId: 'sub-skin', quantity: 1, note: '' }
    const r = buildLineItems('subscription', [l, l, l, l])
    expect(r.ok && r.total).toBe(64000)
  })
})

describe('申込内容の検証', () => {
  it('正常系は正規化された値を返す', () => {
    const r = validateContractInput(baseForm({ name: '  山田\n花子 ' }))
    expect(r.ok && r.value.name).toBe('山田 花子')
  })
  it('日付・氏名・住所・電話の不備を弾く', () => {
    expect(validateContractInput(baseForm({ applicationDate: '2026-02-30' }))).toEqual({ ok: false, error: 'invalid_application_date' })
    expect(validateContractInput(baseForm({ name: ' ' }))).toEqual({ ok: false, error: 'name_required' })
    expect(validateContractInput(baseForm({ address: '' }))).toEqual({ ok: false, error: 'address_required' })
    expect(validateContractInput(baseForm({ phoneNumber: 'abc' }))).toEqual({ ok: false, error: 'phone_invalid' })
    expect(isValidIsoDate('2026-10-02')).toBe(true)
  })
})

describe('content_hash', () => {
  const src = {
    documentType: 'subscription' as const, applicationDate: '2026-10-02', name: 'A', address: 'B', phoneNumber: '1',
    lineItems: [{ course_name: 'x', unit_price: 100, quantity: 2, amount: 200, note: '' }], totalAmount: 200,
    signatureSha256: sha256Hex(PNG_1X1),
  }
  it('同じ内容は同じハッシュ、1か所でも変わると別のハッシュ', () => {
    const h = computeContentHash(src)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(computeContentHash({ ...src })).toBe(h)
    expect(computeContentHash({ ...src, totalAmount: 201 })).not.toBe(h)
    expect(computeContentHash({ ...src, name: 'a' })).not.toBe(h)
    expect(computeContentHash({ ...src, signatureSha256: sha256Hex('x') })).not.toBe(h)
  })
  it('キー順に依らない', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(canonicalJson({ a: [2, { c: 2, d: 1 }], b: 1 }))
  })
})

describe('PDF生成', () => {
  const input = {
    contractId: '00000000-0000-4000-8000-000000000001', documentType: 'subscription' as const,
    applicationDate: '2026-10-02', name: '山田 花子', address: '東京都中央区新富1丁目15-4 CGA 新富 1001号室',
    phoneNumber: '090-1234-5678',
    items: [
      { course_name: '選べる肌改善コース＋化粧品1点', unit_price: 26000, quantity: 2, amount: 52000, note: '商品は店頭でお渡し' },
      { course_name: 'ヒト幹細胞ベーシック 月2回', unit_price: 26000, quantity: 1, amount: 26000, note: '' },
    ],
    total: 78000, signaturePng: PNG_1X1, contentHash: 'a'.repeat(64),
  }
  it('A4縦・1ページのPDFが日本語込みで生成できる', async () => {
    const bytes = await buildContractPdf(input)
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(1)
    const { width, height } = doc.getPage(0).getSize()
    expect(width).toBeCloseTo(A4_WIDTH_PT, 1)
    expect(height).toBeCloseTo(A4_HEIGHT_PT, 1)
    expect(doc.getTitle()).toBe('サブスクリプション申込書')
  })
  it('サブスク(注意書き4つ)に備考つき2行でも1ページに収まる', async () => {
    const bytes = await buildContractPdf({ ...input, items: [
      { ...input.items[0], note: '商品は店頭でお渡し・ご自宅への発送を希望' }, input.items[1] ] })
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1)
  })
  it('PDFに文書IDと内容ハッシュを表示しない(本文のテキストに含まれない)', async () => {
    const bytes = await buildContractPdf(input)
    const raw = Buffer.from(bytes).toString('latin1')
    expect(raw).not.toContain(input.contractId)
    expect(raw).not.toContain('a'.repeat(16))
  })
  it('回数券・4行(備考20文字・数量99)でも1ページに収まる', async () => {
    const item = { course_name: 'ハイドラ×ヒト幹細胞コース 3回', unit_price: 49900, quantity: 99, amount: 4940100, note: 'あ'.repeat(20) }
    const bytes = await buildContractPdf({ ...input, documentType: 'ticket', items: [item, item, item, item], total: item.amount * 4 })
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1)
  })
  it('極端な入力(4行すべて備考40文字)でも壊れず、2ページ以内に収まる', async () => {
    const item = { course_name: 'ハーブピーリング＋ヒト幹細胞コース', unit_price: 17000, quantity: 99, amount: 1683000, note: 'あ'.repeat(40) }
    const bytes = await buildContractPdf({ ...input, items: [item, item, item, item], total: item.amount * 4 })
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeLessThanOrEqual(2)
  })
  it('折り返しは幅を超えない', async () => {
    const doc = await PDFDocument.create()
    const lines = wrapText('あ'.repeat(100), { widthOfTextAtSize: (s: string) => s.length * 10 } as never, 10, 200)
    expect(lines.every(l => l.length <= 20)).toBe(true)
    expect(doc).toBeTruthy()
  })
})
