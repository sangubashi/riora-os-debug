'use client'
/**
 * ContractPaper.tsx — 契約書・申込書のA4縦プレビュー(入力フォーム兼用、2026-10-02)。
 *
 * PDF(buildContractPdf.ts)と同じ構成・同じ文言(contractTemplates.ts): 左揃えのタイトル、黒罫線の4列の表
 * (コース名/数量/金額/備考・空行を含め常に4行・最下段に合計金額)、字下げした注意書き、申込日(年/月/日)・
 * 氏名・住所・電話番号、下段は事業者情報の囲み枠と署名枠(2026-10-02ユーザー提示の見本レイアウト)。
 * editable=trueでは紙の上に直接入力でき、false(確認画面)では入力済みの内容と署名画像を読み取り専用で表示する。
 * 金額は単価×数量の自動計算のみ(手入力不可)。単価は印字しないが、入力中はコース選択の下に小さく表示する。
 * 入力フォントは16px以上(iPad Safariの自動ズーム防止)。
 */
import { memo, useMemo } from 'react'
import { getContractCourses, findContractCourse } from '@/lib/contracts/courseMaster'
import {
  CONTRACT_SALON_LINES, CONTRACT_TABLE_HEADERS, CONTRACT_TEMPLATES, CONTRACT_TOTAL_LABEL,
} from '@/lib/contracts/contractTemplates'
import {
  CONTRACT_MAX_QUANTITY, CONTRACT_MIN_QUANTITY, CONTRACT_NOTE_MAX_LENGTH, type ContractDocumentType,
} from '@/lib/contracts/contractTypes'
import { calcLineAmount, isValidQuantity } from '@/lib/contracts/contractCalc'

// 紙面(PDFと同じ見た目)は黒のみ。アプリ共通のベージュ/ゴールドは使わない。
const PAPER_INK = '#000000'
const PAPER_SUB = '#555555'
const PAPER_INPUT_LINE = '#BDBDBD'
const RULE = '1.5px solid #000'

export interface PaperLine { courseId: string; quantity: number | null; note: string }

export interface PaperValues {
  applicationDate: string
  name:            string
  address:         string
  phoneNumber:     string
  lines:           PaperLine[]
}

interface Props {
  documentType: ContractDocumentType
  values:       PaperValues
  editable:     boolean
  onChange?:    (next: PaperValues) => void
  signatureUrl?: string | null
}

const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', fontSize: '16px', color: PAPER_INK, background: '#FAFAFA',
  border: `1px solid ${PAPER_INPUT_LINE}`, borderRadius: '6px', padding: '8px 10px', fontFamily: 'inherit',
}

export function paperTotal(documentType: ContractDocumentType, lines: PaperLine[]): number {
  return lines.reduce((sum, l) => {
    const c = l.courseId ? findContractCourse(documentType, l.courseId) : null
    return c && isValidQuantity(l.quantity) ? sum + calcLineAmount(c.unitPrice, l.quantity) : sum
  }, 0)
}

function splitDate(iso: string): { y: string; m: string; d: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? { y: String(Number(m[1])), m: String(Number(m[2])), d: String(Number(m[3])) } : { y: '', m: '', d: '' }
}

/** memo化: 署名パッドの描画やステップ切替など、紙面の内容に関係ない親の再描画で再レンダリングしない。 */
function ContractPaperImpl({ documentType, values, editable, onChange, signatureUrl }: Props) {
  const tpl = CONTRACT_TEMPLATES[documentType]
  const courses = useMemo(() => getContractCourses(documentType), [documentType])
  const set = (patch: Partial<PaperValues>) => onChange?.({ ...values, ...patch })
  const setLine = (i: number, patch: Partial<PaperLine>) =>
    set({ lines: values.lines.map((l, k) => (k === i ? { ...l, ...patch } : l)) })

  const total = paperTotal(documentType, values.lines)
  const date = splitDate(values.applicationDate)

  const cell: React.CSSProperties = {
    border: RULE, padding: editable ? '8px 9px' : '0 9px', height: '52px', verticalAlign: 'middle',
    fontSize: '13px', textAlign: 'left',
  }
  const amountCell: React.CSSProperties = { ...cell, textAlign: 'right', whiteSpace: 'nowrap' }

  return (
    <div
      data-testid="contract-paper"
      style={{
        width: '100%', maxWidth: '720px', margin: '0 auto', boxSizing: 'border-box',
        // A4縦(210:297)を最低の高さにし、内容が多ければ伸びる
        minHeight: 'calc(min(100vw - 32px, 720px) * 1.4143)', flexShrink: 0,
        background: '#FFFFFF', color: PAPER_INK, boxShadow: '0 2px 18px rgba(0,0,0,0.14)',
        padding: 'clamp(28px, 9% , 64px) clamp(24px, 9.5%, 64px) clamp(28px, 6%, 48px)',
        display: 'flex', flexDirection: 'column', gap: 'clamp(16px, 3.2vw, 26px)',
        fontSize: '13px', lineHeight: 1.7,
      }}
    >
      <h2 style={{ margin: '0 0 6px', textAlign: 'left', fontSize: 'clamp(22px, 4.4vw, 30px)', fontWeight: 400, letterSpacing: '0.02em' }}>
        {tpl.title}
      </h2>
      <p style={{ margin: 0, fontSize: '12.5px' }}>{tpl.intro}</p>

      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: '43%' }} /><col style={{ width: '11%' }} /><col style={{ width: '24%' }} /><col style={{ width: '22%' }} />
        </colgroup>
        <thead>
          <tr>
            {CONTRACT_TABLE_HEADERS.map(h => (
              <th key={h} style={{ ...cell, height: '40px', fontWeight: 400, fontSize: '12.5px' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {values.lines.map((l, i) => {
            const c = l.courseId ? findContractCourse(documentType, l.courseId) : null
            const qtyOk = isValidQuantity(l.quantity)
            const amount = c && qtyOk ? calcLineAmount(c.unitPrice, l.quantity as number) : null
            return (
              <tr key={i} data-testid={`contract-line-${i}`}>
                <td style={cell}>
                  {editable ? (
                    <>
                      <select
                        aria-label={`コース名(${i + 1}行目)`}
                        data-testid={`line-course-${i}`}
                        value={l.courseId}
                        onChange={e => {
                          const courseId = e.target.value
                          // 「選択してください」(未選択)に戻したら数量も空にする。選んだときは数量の既定値を1にする。
                          setLine(i, { courseId, quantity: courseId ? (l.quantity ?? 1) : null })
                        }}
                        style={inputStyle}
                      >
                        <option value="">選択してください</option>
                        {courses.map(co => <option key={co.id} value={co.id}>{co.name}</option>)}
                      </select>
                      {/* 単価は印字しない(PDF・確認画面には出ない)。入力中の確認用に小さく表示する。 */}
                      <div data-testid={`line-unit-${i}`} style={{ minHeight: '16px', marginTop: '2px', fontSize: '11px', color: PAPER_SUB }}>
                        {c ? `単価 ${yen(c.unitPrice)}` : ''}
                      </div>
                    </>
                  ) : c?.name}
                </td>
                <td style={cell}>
                  {editable ? (
                    <input
                      aria-label={`数量(${i + 1}行目)`}
                      data-testid={`line-qty-${i}`}
                      type="number" inputMode="numeric" min={CONTRACT_MIN_QUANTITY} max={CONTRACT_MAX_QUANTITY} step={1}
                      value={l.quantity ?? ''}
                      disabled={!l.courseId}
                      onChange={e => {
                        const raw = e.target.value
                        if (raw === '') return setLine(i, { quantity: null })
                        const n = Math.trunc(Number(raw))
                        setLine(i, { quantity: Number.isFinite(n) ? Math.min(CONTRACT_MAX_QUANTITY, Math.max(0, n)) : null })
                      }}
                      style={{ ...inputStyle, padding: '8px 4px', textAlign: 'center' }}
                    />
                  ) : l.courseId ? l.quantity : ''}
                </td>
                <td style={amountCell} data-testid={`line-amount-${i}`}>{amount !== null ? yen(amount) : ''}</td>
                <td style={cell}>
                  {editable ? (
                    <input
                      aria-label={`備考(${i + 1}行目)`}
                      data-testid={`line-note-${i}`}
                      value={l.note} maxLength={CONTRACT_NOTE_MAX_LENGTH}
                      onChange={e => setLine(i, { note: e.target.value })}
                      style={inputStyle}
                    />
                  ) : <span style={{ fontSize: '11.5px', wordBreak: 'break-word' }}>{l.note}</span>}
                </td>
              </tr>
            )
          })}
          {/* 合計: 「合計金額」は数量の列、合計は金額の列(見本どおり) */}
          <tr>
            <td style={{ ...cell, height: '48px' }} />
            <td style={{ ...cell, height: '48px', fontSize: '11px', padding: '0 4px', textAlign: 'center' }}>{CONTRACT_TOTAL_LABEL}</td>
            <td style={{ ...amountCell, height: '48px', fontSize: '15px' }} data-testid="contract-total">{yen(total)}</td>
            <td style={{ ...cell, height: '48px' }} />
          </tr>
        </tbody>
      </table>

      {/* 注意書き: 「※」を行頭に出し、2行目以降を字下げ(ぶら下げインデント) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '12px', lineHeight: 1.7, marginTop: '4px' }}>
        {tpl.notes.map(n => (
          <p key={n} style={{ margin: 0, paddingLeft: '1.1em', textIndent: '-1.1em' }}>{n}</p>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', paddingLeft: 'clamp(8px, 2.4vw, 20px)', marginTop: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{ minWidth: '5.4em' }}>申込日</span>
          {editable ? (
            <>
              <input
                aria-label="申込日" data-testid="field-date" type="date" value={values.applicationDate}
                onChange={e => set({ applicationDate: e.target.value })}
                style={{ ...inputStyle, width: 'auto', minWidth: '170px' }}
              />
              <button
                type="button" data-testid="field-date-today"
                onClick={() => {
                  const d = new Date()
                  const p = (n: number) => String(n).padStart(2, '0')
                  set({ applicationDate: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` })
                }}
                style={{ padding: '8px 12px', borderRadius: '999px', border: `1px solid ${PAPER_INPUT_LINE}`, background: 'none', color: PAPER_INK, fontSize: '13px', cursor: 'pointer' }}
              >
                今日
              </button>
            </>
          ) : (
            <span data-testid="contract-date-text" style={{ display: 'flex', alignItems: 'baseline', gap: '0.5em' }}>
              <span style={{ minWidth: '2.6em', textAlign: 'right' }}>{date.y}</span>年
              <span style={{ minWidth: '3.4em', textAlign: 'right' }}>{date.m}</span>月
              <span style={{ minWidth: '3.4em', textAlign: 'right' }}>{date.d}</span>日
            </span>
          )}
        </div>
        <Field label="氏名：" editable={editable} value={values.name} testId="field-name" onChange={v => set({ name: v })} />
        <Field label="住所：" editable={editable} value={values.address} testId="field-address" onChange={v => set({ address: v })} />
        <Field label="電話番号：" editable={editable} value={values.phoneNumber} testId="field-phone" inputMode="tel" onChange={v => set({ phoneNumber: v })} />
      </div>

      {/* 下段: 事業者情報の囲み枠(左)と署名枠(右) */}
      <div style={{ marginTop: 'auto', paddingTop: '8px', display: 'grid', gridTemplateColumns: 'minmax(0, 1.7fr) minmax(0, 1fr)', gap: 'clamp(12px, 3vw, 24px)', alignItems: 'stretch' }}>
        <div data-testid="contract-salon" style={{ border: RULE, padding: '14px 16px', fontSize: '12px', lineHeight: 1.85 }}>
          {CONTRACT_SALON_LINES.map(([label, value]) => <div key={label}>{label}：{value}</div>)}
        </div>
        <div data-testid="contract-signature-box" style={{ border: RULE, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '4px', minHeight: '110px' }}>
          <span style={{ fontSize: '11px' }}>署名</span>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '70px' }}>
            {signatureUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={signatureUrl} alt="署名" data-testid="contract-signature-img" style={{ maxWidth: '100%', maxHeight: '90px' }} />
            ) : editable ? (
              <span style={{ fontSize: '11px', color: PAPER_SUB }}>署名は次の画面で行います</span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

const ContractPaper = memo(ContractPaperImpl)
export default ContractPaper

const Field = memo(function Field({ label, value, editable, onChange, testId, inputMode }: {
  label: string; value: string; editable: boolean; onChange: (v: string) => void; testId: string
  inputMode?: 'tel' | 'text'
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      <span style={{ minWidth: '5.4em', flexShrink: 0 }}>{label}</span>
      {editable ? (
        <input
          aria-label={label.replace('：', '')} data-testid={testId} value={value} inputMode={inputMode}
          onChange={e => onChange(e.target.value)} style={inputStyle}
        />
      ) : <span style={{ wordBreak: 'break-word' }}>{value}</span>}
    </div>
  )
})
