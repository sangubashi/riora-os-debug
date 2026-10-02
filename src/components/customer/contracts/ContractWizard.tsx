'use client'
/**
 * ContractWizard.tsx — 契約書・申込書の作成フロー(2026-10-02)。
 *
 * ①書類種類 → ②申込内容(A4の紙に直接入力) → ③署名 → ④確認 → ⑤保存 の順に進む。
 * 顧客情報(氏名・住所・電話番号)は既存の顧客情報から自動入力せず、手入力する。
 * 保存後は編集・差し替え・削除できない(APIも存在しない)。保存はサーバーがPDFを生成する。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, useTransition, type MutableRefObject } from 'react'
import { Check, ChevronLeft, ChevronRight, Eraser, Undo2, X } from 'lucide-react'
import { PALETTE, headingFont } from '@/components/customer/shared/PhotoCompareKit'
import { CONTRACT_DOCUMENT_TYPES, CONTRACT_MAX_LINES, type ContractDocumentType, type ContractFormValues } from '@/lib/contracts/contractTypes'
import { CONTRACT_DOCUMENT_TYPE_LABEL } from '@/lib/contracts/contractTemplates'
import { CONTRACT_ERROR_MESSAGES, validateContractInput } from '@/lib/contracts/contractCalc'
import { ContractApiError, createContract, type ContractSummary } from '@/lib/contracts/contractsApiClient'
import ContractPaper, { type PaperValues } from './ContractPaper'
import SignaturePad, { type SignaturePadHandle } from './SignaturePad'

type Step = 'type' | 'form' | 'sign' | 'confirm' | 'done'
const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'type', label: '書類種類' }, { id: 'form', label: '申込内容' }, { id: 'sign', label: '署名' },
  { id: 'confirm', label: '確認' }, { id: 'done', label: '保存' },
]

const emptyValues = (): PaperValues => ({
  applicationDate: '', name: '', address: '', phoneNumber: '',
  lines: Array.from({ length: CONTRACT_MAX_LINES }, () => ({ courseId: '', quantity: null, note: '' })),
})

interface Props {
  customerId: string
  /** 店舗共通ログイン時に選択済みの担当者(brain_staff.id)。個人ログイン時はnull。 */
  staffId: string | null
  onClose: () => void
  onSaved: (contract: ContractSummary) => void
}

export default function ContractWizard({ customerId, staffId, onClose, onSaved }: Props) {
  const [step, setStep] = useState<Step>('type')
  const [documentType, setDocumentType] = useState<ContractDocumentType | null>(null)
  const [values, setValues] = useState<PaperValues>(emptyValues)
  const [error, setError] = useState<string | null>(null)
  const [hasInk, setHasInk] = useState(false)
  const [signatureBlob, setSignatureBlob] = useState<Blob | null>(null)
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<ContractSummary | null>(null)
  const padRef = useRef<SignaturePadHandle | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  // ステップ切替(申込内容→署名など)は重い再描画を伴うため transition にし、押した瞬間の
  // フィードバック(ボタンの「準備中…」)を先に描画する。iPad Safariでの引っかかり対策。
  const [navPending, startNav] = useTransition()

  useEffect(() => () => { if (signatureUrl) URL.revokeObjectURL(signatureUrl) }, [signatureUrl])
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }) }, [step])

  const formValues: ContractFormValues | null = useMemo(() => documentType && ({
    documentType, applicationDate: values.applicationDate, name: values.name, address: values.address,
    phoneNumber: values.phoneNumber,
    // コース未選択の行は、数量が残っていても検証・合計・送信から完全に除外する。
    // (備考だけが入った行は、黙って捨てず「コースを選んでください」と知らせるために残す)
    lines: values.lines
      .filter(l => l.courseId || l.note.trim() !== '')
      .map(l => ({ courseId: l.courseId || null, quantity: l.courseId ? l.quantity : null, note: l.note })),
  }), [documentType, values])

  const stepIndex = STEPS.findIndex(s => s.id === step)

  const chooseType = useCallback((t: ContractDocumentType) => {
    if (t !== documentType) setValues(emptyValues()) // 別の書類ではコース一覧が違うため入力をリセット
    setDocumentType(t)
    setError(null)
    startNav(() => setStep('form'))
  }, [documentType])

  const goSign = useCallback(() => {
    if (!formValues || navPending) return
    const v = validateContractInput(formValues)
    if (!v.ok) { setError(CONTRACT_ERROR_MESSAGES[v.error]); return }
    setError(null)
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    startNav(() => setStep('sign'))
  }, [formValues, navPending])

  async function goConfirm() {
    const blob = await padRef.current?.toPngBlob()
    if (!blob) { setError('署名してください'); return }
    setError(null)
    startNav(() => {
      setSignatureBlob(blob)
      setSignatureUrl(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob) })
      setStep('confirm')
    })
  }

  async function save() {
    if (!formValues || !signatureBlob || saving) return
    setSaving(true)
    setError(null)
    try {
      const contract = await createContract(customerId, formValues, signatureBlob, staffId)
      setSaved(contract)
      setStep('done')
      onSaved(contract)
    } catch (e) {
      const code = e instanceof ContractApiError ? e.validationCode : undefined
      setError(code ? CONTRACT_ERROR_MESSAGES[code] : '保存できませんでした。通信状況を確認してもう一度お試しください。')
    } finally {
      setSaving(false)
    }
  }

  const btn = (primary: boolean, disabled = false): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '13px 22px',
    borderRadius: '999px', fontSize: '15px', fontWeight: 700, cursor: disabled ? 'default' : 'pointer',
    border: primary ? 'none' : `1.5px solid ${PALETTE.border}`,
    background: primary ? (disabled ? PALETTE.border : PALETTE.gold) : 'none',
    color: primary ? '#fff' : PALETTE.text,
  })

  return (
    <div
      data-testid="contract-wizard"
      style={{ position: 'fixed', inset: 0, zIndex: 500, background: PALETTE.bg, display: 'flex', flexDirection: 'column' }}
    >
      <div style={{
        flexShrink: 0, padding: 'max(14px, calc(env(safe-area-inset-top) + 10px)) 20px 12px',
        borderBottom: `1px solid ${PALETTE.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '16px', color: PALETTE.gold, marginRight: '8px', fontFamily: headingFont.style.fontFamily }}>契約書・申込書</span>
          {STEPS.map((s, i) => (
            <span
              key={s.id} data-testid={`step-${s.id}`} aria-current={i === stepIndex ? 'step' : undefined}
              style={{
                fontSize: '12px', padding: '4px 10px', borderRadius: '999px',
                background: i === stepIndex ? PALETTE.gold : 'transparent',
                color: i === stepIndex ? '#fff' : i < stepIndex ? PALETTE.text : PALETTE.muted,
                border: `1px solid ${i === stepIndex ? PALETTE.gold : PALETTE.border}`,
              }}
            >
              {['①', '②', '③', '④', '⑤'][i]} {s.label}
            </span>
          ))}
        </div>
        <button type="button" onClick={onClose} aria-label="閉じる" style={{ width: '38px', height: '38px', borderRadius: '50%', border: `1px solid ${PALETTE.border}`, background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <X size={16} color={PALETTE.text} />
        </button>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '20px 16px 28px', WebkitOverflowScrolling: 'touch' }}>
        {step === 'type' && (
          <div style={{ maxWidth: '640px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <p style={{ margin: 0, fontSize: '15px', color: PALETTE.text }}>作成する書類を選んでください。</p>
            {CONTRACT_DOCUMENT_TYPES.map(t => (
              <button
                key={t} type="button" data-testid={`type-${t}`} onClick={() => chooseType(t)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '22px 24px',
                  borderRadius: '16px', border: `1.5px solid ${PALETTE.border}`, background: PALETTE.card,
                  color: PALETTE.text, fontSize: '18px', fontWeight: 700, cursor: 'pointer',
                }}
              >
                {CONTRACT_DOCUMENT_TYPE_LABEL[t]}<ChevronRight size={20} color={PALETTE.gold} />
              </button>
            ))}
          </div>
        )}

        {step === 'form' && documentType && <FormStep documentType={documentType} values={values} onChange={setValues} />}

        {step === 'sign' && <SignStep padRef={padRef} hasInk={hasInk} onInkChange={setHasInk} />}

        {step === 'confirm' && documentType && <ConfirmStep documentType={documentType} values={values} signatureUrl={signatureUrl} />}

        {step === 'done' && saved && (
          <div style={{ maxWidth: '520px', margin: '40px auto 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', textAlign: 'center' }}>
            <span style={{ width: '56px', height: '56px', borderRadius: '50%', background: PALETTE.gold, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Check size={30} color="#fff" />
            </span>
            <p data-testid="contract-saved" style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: PALETTE.text }}>保存しました</p>
            <p style={{ margin: 0, fontSize: '13px', color: PALETTE.muted }}>PDFは顧客の「契約書・申込書」の履歴から、いつでも開けます。</p>
            {saved.pdfUrl && (
              <a href={saved.pdfUrl} target="_blank" rel="noopener noreferrer" data-testid="saved-pdf-link" style={{ ...btn(true), textDecoration: 'none' }}>
                PDFを見る
              </a>
            )}
          </div>
        )}
      </div>

      <div style={{ flexShrink: 0, borderTop: `1px solid ${PALETTE.border}`, padding: '12px 20px max(12px, env(safe-area-inset-bottom))', background: PALETTE.card }}>
        {error && <p role="alert" data-testid="wizard-error" style={{ margin: '0 0 8px', textAlign: 'center', fontSize: '13px', color: '#b3402e' }}>{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', maxWidth: '720px', margin: '0 auto' }}>
          {step === 'form' && <>
            <button type="button" onClick={() => { setError(null); setStep('type') }} style={btn(false)}><ChevronLeft size={16} />書類種類へ</button>
            <button type="button" data-testid="to-sign" onClick={goSign} disabled={navPending} style={btn(true, navPending)}>{navPending ? '準備中…' : <>署名へ進む<ChevronRight size={16} /></>}</button>
          </>}
          {step === 'sign' && <>
            <button type="button" onClick={() => { setError(null); setStep('form') }} style={btn(false)}><ChevronLeft size={16} />申込内容へ戻る</button>
            <button type="button" data-testid="to-confirm" onClick={() => { void goConfirm() }} disabled={!hasInk || navPending} style={btn(true, !hasInk || navPending)}>{navPending ? '準備中…' : <>確認へ進む<ChevronRight size={16} /></>}</button>
          </>}
          {step === 'confirm' && <>
            <button type="button" onClick={() => { setError(null); setStep('sign') }} disabled={saving} style={btn(false)}><ChevronLeft size={16} />署名をやり直す</button>
            <button type="button" data-testid="save" onClick={() => { void save() }} disabled={saving} style={btn(true, saving)}>
              {saving ? '保存中…' : 'この内容で保存する'}
            </button>
          </>}
          {step === 'done' && <button type="button" onClick={onClose} style={{ ...btn(false), marginLeft: 'auto' }}>閉じる</button>}
        </div>
      </div>
    </div>
  )
}

// ── ステップ別コンポーネント(memo化) ─────────────────────────────────
// 親(ContractWizard)のerror/navPending/hasInk等の更新で、紙面・署名パッドが再レンダリングされない
// ようにする。propsは安定した参照(setState・ref・値)だけを渡す。

const outlineBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '13px 22px',
  borderRadius: '999px', fontSize: '15px', fontWeight: 700, cursor: 'pointer',
  border: `1.5px solid ${PALETTE.border}`, background: 'none', color: PALETTE.text,
}

const FormStep = memo(function FormStep({ documentType, values, onChange }: {
  documentType: ContractDocumentType; values: PaperValues; onChange: (v: PaperValues) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <p style={{ margin: '0 auto', maxWidth: '720px', width: '100%', fontSize: '13px', color: PALETTE.muted }}>
        紙の申込書と同じ並びです。申込日・氏名・住所・電話番号は手で入力してください(顧客情報からの自動入力はしません)。
        コースを選ぶと単価が表示され、数量を入れると金額が自動計算されます。
      </p>
      <ContractPaper documentType={documentType} values={values} editable onChange={onChange} />
    </div>
  )
})

const SignStep = memo(function SignStep({ padRef, hasInk, onInkChange }: {
  padRef: MutableRefObject<SignaturePadHandle | null>; hasInk: boolean; onInkChange: (hasInk: boolean) => void
}) {
  return (
    <div style={{ maxWidth: '720px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <p style={{ margin: 0, fontSize: '15px', color: PALETTE.text }}>お客様ご本人が、下の枠に指またはApple Pencilで署名してください。</p>
      <SignaturePad ref={padRef} height={260} onInkChange={onInkChange} />
      <div style={{ display: 'flex', gap: '10px' }}>
        <button type="button" onClick={() => padRef.current?.undo()} disabled={!hasInk} style={{ ...outlineBtn, opacity: hasInk ? 1 : 0.4 }}>
          <Undo2 size={16} />ひとつ戻す
        </button>
        <button type="button" data-testid="sign-clear" onClick={() => padRef.current?.clear()} disabled={!hasInk} style={{ ...outlineBtn, opacity: hasInk ? 1 : 0.4 }}>
          <Eraser size={16} />書き直す
        </button>
      </div>
    </div>
  )
})

const ConfirmStep = memo(function ConfirmStep({ documentType, values, signatureUrl }: {
  documentType: ContractDocumentType; values: PaperValues; signatureUrl: string | null
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <p style={{ margin: '0 auto', maxWidth: '720px', width: '100%', fontSize: '14px', fontWeight: 700, color: PALETTE.text }}>
        内容と署名をご確認ください。保存すると、あとから編集・差し替え・削除はできません。
      </p>
      <ContractPaper documentType={documentType} values={values} editable={false} signatureUrl={signatureUrl} />
    </div>
  )
})
