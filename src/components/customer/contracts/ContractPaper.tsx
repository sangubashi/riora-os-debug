'use client'
/**
 * ContractPaper.tsx — 契約書・申込書のA4縦プレビュー(入力フォーム兼用、2026-10-02)。
 *
 * PDFと同じ並び・同じ文言(contractTemplates.ts)で表示する。editable=trueでは紙の上に直接
 * 入力でき、false(確認画面)では入力済みの内容と署名画像を読み取り専用で表示する。
 * 金額は単価×数量の自動計算のみ(手入力不可)。入力フォントは16px以上(iPad Safariの自動ズーム防止)。
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

// 紙面(PDFと同じ見た目)は黒・薄グレーのみ。アプリ共通のベージュ/ゴールドは使わない(2026-10-02ユーザー指示)。
const PAPER_INK = '#111111'
const PAPER_LINE = '#C4C4C4'
const PAPER_HEAD_BG = '#F2F2F2'

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
  border: `1px solid ${PAPER_LINE}`, borderRadius: '6px', padding: '8px 10px', fontFamily: 'inherit',
}

function formatDateJa(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日` : '年　月　日'
}

export function paperTotal(documentType: ContractDocumentType, lines: PaperLine[]): number {
  return lines.reduce((sum, l) => {
    const c = l.courseId ? findContractCourse(documentType, l.courseId) : null
    return c && isValidQuantity(l.quantity) ? sum + calcLineAmount(c.unitPrice, l.quantity) : sum
  }, 0)
}

/** memo化: 署名パッドの描画やステップ切替など、紙面の内容に関係ない親の再描画で再レンダリングしない。 */
function ContractPaperImpl({ documentType, values, editable, onChange, signatureUrl }: Props) {
  const tpl = CONTRACT_TEMPLATES[documentType]
  const courses = useMemo(() => getContractCourses(documentType), [documentType])
  const set = (patch: Partial<PaperValues>) => onChange?.({ ...values, ...patch })
  const setLine = (i: number, patch: Partial<PaperLine>) =>
    set({ lines: values.lines.map((l, k) => (k === i ? { ...l, ...patch } : l)) })

  const visibleLines = editable ? values.lines : values.lines.filter(l => l.courseId)
  const total = paperTotal(documentType, values.lines)

  const cell: React.CSSProperties = { padding: '11px 10px', borderBottom: `1px solid ${PAPER_LINE}`, verticalAlign: 'middle' }
  const num: React.CSSProperties = { ...cell, textAlign: 'right', whiteSpace: 'nowrap' }

  return (
    <div
      data-testid="contract-paper"
      style={{
        width: '100%', maxWidth: '720px', margin: '0 auto', boxSizing: 'border-box', minHeight: 'calc(min(100vw - 32px, 720px) * 1.4143)', flexShrink: 0, /* A4縦(210:297)を最低の高さにし、内容が多ければ伸びる */
        background: '#FFFFFF', color: PAPER_INK, boxShadow: '0 2px 18px rgba(0,0,0,0.14)',
        padding: 'clamp(28px, 7%, 60px)', display: 'flex', flexDirection: 'column', gap: '24px',
        fontSize: '13px', lineHeight: 1.7,
      }}
    >
      <h2 style={{ margin: 0, textAlign: 'center', fontSize: '22px', fontWeight: 700 }}>{tpl.title}</h2>
      <p style={{ margin: 0 }}>{tpl.intro}</p>

      <table style={{ width: '100%', borderCollapse: 'collapse', border: `1px solid ${PAPER_LINE}`, tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: '34%' }} /><col style={{ width: '12%' }} /><col style={{ width: '15%' }} />
          <col style={{ width: '16%' }} /><col style={{ width: '23%' }} />
        </colgroup>
        <thead>
          <tr style={{ background: PAPER_HEAD_BG }}>
            {CONTRACT_TABLE_HEADERS.map((h, i) => (
              <th key={h} style={{ ...cell, textAlign: i >= 1 && i <= 3 ? 'right' : 'left', fontWeight: 600, fontSize: '12px' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleLines.map((l, idx) => {
            const i = editable ? idx : values.lines.indexOf(l)
            const c = l.courseId ? findContractCourse(documentType, l.courseId) : null
            const qtyOk = isValidQuantity(l.quantity)
            const amount = c && qtyOk ? calcLineAmount(c.unitPrice, l.quantity as number) : null
            return (
              <tr key={i} data-testid={`contract-line-${i}`}>
                <td style={cell}>
                  {editable ? (
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
                  ) : c?.name}
                </td>
                <td style={num}>
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
                      style={{ ...inputStyle, textAlign: 'right', padding: '8px 4px' }}
                    />
                  ) : l.quantity}
                </td>
                <td style={num} data-testid={`line-unit-${i}`}>{c ? yen(c.unitPrice) : ''}</td>
                <td style={num} data-testid={`line-amount-${i}`}>{amount !== null ? yen(amount) : ''}</td>
                <td style={cell}>
                  {editable ? (
                    <input
                      aria-label={`備考(${i + 1}行目)`}
                      data-testid={`line-note-${i}`}
                      value={l.note} maxLength={CONTRACT_NOTE_MAX_LENGTH}
                      onChange={e => setLine(i, { note: e.target.value })}
                      style={inputStyle}
                    />
                  ) : l.note}
                </td>
              </tr>
            )
          })}
          <tr style={{ background: PAPER_HEAD_BG }}>
            <td style={{ ...cell, fontWeight: 600 }} colSpan={3}>{CONTRACT_TOTAL_LABEL}</td>
            <td style={{ ...num, fontWeight: 700, fontSize: '15px' }} colSpan={2} data-testid="contract-total">{yen(total)}</td>
          </tr>
        </tbody>
      </table>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11.5px' }}>
        {tpl.notes.map(n => <p key={n} style={{ margin: 0 }}>{n}</p>)}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ flexShrink: 0 }}>申込日</span>
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
                style={{ padding: '8px 12px', borderRadius: '999px', border: `1px solid ${PAPER_LINE}`, background: 'none', color: PAPER_INK, fontSize: '13px', cursor: 'pointer' }}
              >
                今日
              </button>
            </>
          ) : <span>{formatDateJa(values.applicationDate)}</span>}
        </div>
        <Field label="氏名：" editable={editable} value={values.name} testId="field-name" onChange={v => set({ name: v })} />
        <Field label="住所：" editable={editable} value={values.address} testId="field-address" onChange={v => set({ address: v })} />
        <Field label="電話番号：" editable={editable} value={values.phoneNumber} testId="field-phone" inputMode="tel" onChange={v => set({ phoneNumber: v })} />
      </div>

      {signatureUrl !== undefined && (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px' }}>
          <span style={{ flexShrink: 0 }}>署名：</span>
          <div style={{ width: '240px', height: '84px', border: `1px solid ${PAPER_LINE}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {signatureUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={signatureUrl} alt="署名" data-testid="contract-signature-img" style={{ maxWidth: '100%', maxHeight: '100%' }} />
            )}
          </div>
        </div>
      )}

      <div data-testid="contract-salon" style={{ marginTop: 'auto', fontSize: '12px', lineHeight: 1.8 }}>
        {CONTRACT_SALON_LINES.map(([label, value]) => <div key={label}>{label}：{value}</div>)}
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
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span style={{ flexShrink: 0 }}>{label}</span>
      {editable ? (
        <input
          aria-label={label.replace('：', '')} data-testid={testId} value={value} inputMode={inputMode}
          onChange={e => onChange(e.target.value)} style={inputStyle}
        />
      ) : <span style={{ wordBreak: 'break-word' }}>{value}</span>}
    </div>
  )
})
