'use client'
/**
 * BusinessSettingsForm.tsx — 固定費・変動費率 設定画面(MD-1: 経営TOP の入力元)
 *
 * 設計根拠: docs/architecture/Riora_損益分岐・コスト構造_設計書_v1.0.md §4
 *
 * fixed_costs/variable_ratesの内訳を入力し、POST /api/admin/business-settingsへ保存する。
 * 損益分岐点・利益予測の計算式(DashboardAggregator)はここでは一切実行しない
 * (保存するのは入力データのみ・計算式変更禁止)。
 */
import { useEffect, useState } from 'react'
import { Save, CheckCircle2, AlertCircle } from 'lucide-react'
import { useBusinessSettingsStore, type CostBreakdown } from '@/store/useBusinessSettingsStore'
import { DEMO_STORE_ID } from '@/lib/constants'

function firstOfMonth(): string {
  return `${new Date().toISOString().slice(0, 7)}-01`
}

const FIXED_COST_FIELDS: { key: string; label: string }[] = [
  { key: 'officer_suzuki', label: '役員報酬(鈴木)' },
  { key: 'officer_kishi', label: '役員報酬(岸)' },
  { key: 'outsource_kubota', label: '外注費(久保田)' },
  { key: 'salary_kameyama', label: '固定給(亀山)' },
  { key: 'salary_todate', label: '固定給(外舘)' },
  { key: 'commute', label: '交通費' },
  { key: 'rent', label: '家賃' },
  { key: 'ad_hotpepper', label: 'HotPepper広告費' },
  { key: 'freee_monthly', label: 'freee月割' },
  { key: 'social_insurance_estimate', label: '社会保険料(概算)' },
  { key: 'social_insurance_actual', label: '社会保険料(実額・freee確定後)' },
  { key: 'utilities', label: '水道光熱費(実績入力)' },
  { key: 'telecom', label: '通信費(実績入力)' },
  { key: 'supplies', label: '消耗品・施術材料(実績入力)' },
]

const VARIABLE_RATE_FIELDS: { key: string; label: string }[] = [
  { key: 'incentive_rate', label: 'インセンティブ率(例: 0.05 = 5%)' },
  { key: 'nomination_back', label: '指名バック(1件あたり・円)' },
  { key: 'social_insurance_rate', label: '社保概算係数(例: 0.155 = 15.5%)' },
  { key: 'square_rate', label: 'Square決済手数料率(例: 0.025 = 2.5%)' },
  { key: 'cashless_ratio', label: 'キャッシュレス比率(例: 1.0 = 100%)' },
  { key: 'retail_cost_rate', label: '物販原価率' },
]

// PHASE SALES_TARGET_GUARD_1: sales_target=210のような単位間違い(万円のつもりで
// 円単位のまま保存)を防ぐための警告閾値。ハードブロックはせず、確認ダイアログで
// 一呼吸置くだけに留める(正当な理由で閾値外の値を入れたいケースを塞がないため)。
const SALES_TARGET_MIN_WARN = 100_000
const SALES_TARGET_MAX_WARN = 50_000_000

function salesTargetWarning(value: number): string | null {
  if (value < SALES_TARGET_MIN_WARN) {
    return `売上目標が¥${value.toLocaleString('ja-JP')}です。円単位の入力で合っていますか?(万円のつもりで入力していませんか?)`
  }
  if (value > SALES_TARGET_MAX_WARN) {
    return `売上目標が¥${value.toLocaleString('ja-JP')}です。金額の桁数が大きすぎませんか?`
  }
  return null
}

type Draft = Record<string, string>

function toDraft(breakdown: Record<string, unknown> | null | undefined, fields: { key: string }[]): Draft {
  const draft: Draft = {}
  for (const f of fields) {
    const v = breakdown?.[f.key]
    draft[f.key] = typeof v === 'number' ? String(v) : ''
  }
  return draft
}

function draftToBreakdown(draft: Draft): CostBreakdown {
  const result: CostBreakdown = {}
  for (const [key, raw] of Object.entries(draft)) {
    const trimmed = raw.trim()
    result[key] = trimmed === '' ? null : Number(trimmed)
  }
  return result
}

function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: '#5C4033' }}>
      {label}
      <input
        type="number"
        step="any"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="未入力"
        style={{
          padding: '8px 10px', borderRadius: '8px', border: '1px solid #F0DEE2',
          fontSize: '13px', fontFamily: 'Inter, sans-serif',
        }}
      />
    </label>
  )
}

export default function BusinessSettingsForm() {
  const { settings, isLoading, isSaving, error, saveError, saveSuccess, fetchSettings, saveSettings } = useBusinessSettingsStore()
  const month = firstOfMonth()

  const [salesTarget, setSalesTarget] = useState('')
  const [variableCostRate, setVariableCostRate] = useState('')
  const [fixedCosts, setFixedCosts] = useState<Draft>(toDraft(null, FIXED_COST_FIELDS))
  const [variableRates, setVariableRates] = useState<Draft>(toDraft(null, VARIABLE_RATE_FIELDS))

  useEffect(() => {
    fetchSettings(DEMO_STORE_ID, month)
  }, [fetchSettings, month])

  useEffect(() => {
    if (!settings) return
    setSalesTarget(String(settings.salesTarget ?? ''))
    setVariableCostRate(String(settings.variableCostRate ?? ''))
    setFixedCosts(toDraft(settings.fixedCosts, FIXED_COST_FIELDS))
    setVariableRates(toDraft(settings.variableRates, VARIABLE_RATE_FIELDS))
  }, [settings])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    const trimmed = salesTarget.trim()
    if (trimmed !== '') {
      const warning = salesTargetWarning(Number(trimmed))
      if (warning && !window.confirm(`${warning}\n\n本当にこの値で保存しますか?`)) return
    }

    await saveSettings({
      storeId: DEMO_STORE_ID,
      month,
      salesTarget: salesTarget.trim() === '' ? undefined : Number(salesTarget),
      variableCostRate: variableCostRate.trim() === '' ? undefined : Number(variableCostRate),
      fixedCosts: draftToBreakdown(fixedCosts),
      variableRates: draftToBreakdown(variableRates),
    })
  }

  if (isLoading && !settings) {
    return <p style={{ padding: '24px', color: '#C8A8B0', fontSize: '13px' }}>読み込み中...</p>
  }
  if (error) {
    return <p style={{ padding: '24px', color: '#D14F4F', fontSize: '13px' }}>設定の取得に失敗しました: {error}</p>
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '16px', maxWidth: '560px' }}>
      <div>
        <h1 style={{ fontSize: '16px', fontWeight: 700, color: '#5C4033', marginBottom: '4px' }}>固定費・変動費率設定</h1>
        <p style={{ fontSize: '12px', color: '#9F7E6C' }}>対象月: {month}。ここで保存した値を元に、損益分岐点・利益予測が翌日の集計(nightly)で更新されます。</p>
      </div>

      <section style={{ background: '#fff', border: '1px solid #F5EEF0', borderRadius: '16px', padding: '16px 18px' }}>
        <p style={{ fontSize: '13px', fontWeight: 700, color: '#5C4033', marginBottom: '12px' }}>売上目標</p>
        <NumberField label="今月の売上目標(円)" value={salesTarget} onChange={setSalesTarget} />
        <p style={{ fontSize: '11px', color: '#9F7E6C', marginTop: '6px' }}>
          円単位で入力してください(万円ではありません)。例: 210万円の場合は 2100000 と入力
        </p>
      </section>

      <section style={{ background: '#fff', border: '1px solid #F5EEF0', borderRadius: '16px', padding: '16px 18px' }}>
        <p style={{ fontSize: '13px', fontWeight: 700, color: '#5C4033', marginBottom: '4px' }}>固定費の内訳</p>
        <p style={{ fontSize: '11px', color: '#9F7E6C', marginBottom: '12px' }}>未入力(空欄)の項目はnullとして保存され、損益分岐点・利益予測の計算対象から除外されます。</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
          {FIXED_COST_FIELDS.map((f) => (
            <NumberField
              key={f.key}
              label={f.label}
              value={fixedCosts[f.key] ?? ''}
              onChange={(v) => setFixedCosts((prev) => ({ ...prev, [f.key]: v }))}
            />
          ))}
        </div>
      </section>

      <section style={{ background: '#fff', border: '1px solid #F5EEF0', borderRadius: '16px', padding: '16px 18px' }}>
        <p style={{ fontSize: '13px', fontWeight: 700, color: '#5C4033', marginBottom: '4px' }}>変動費率(計算に使用する値)</p>
        <p style={{ fontSize: '11px', color: '#9F7E6C', marginBottom: '12px' }}>損益分岐点・利益予測の計算式は実際にこの値(0〜1)を使用します(下の「変動費率の内訳」は記録用で、計算式へは反映されません)。</p>
        <NumberField label="変動費率(例: 0.075 = 7.5%)" value={variableCostRate} onChange={setVariableCostRate} />
      </section>

      <section style={{ background: '#fff', border: '1px solid #F5EEF0', borderRadius: '16px', padding: '16px 18px' }}>
        <p style={{ fontSize: '13px', fontWeight: 700, color: '#5C4033', marginBottom: '4px' }}>変動費率の内訳(記録用)</p>
        <p style={{ fontSize: '11px', color: '#9F7E6C', marginBottom: '12px' }}>内訳の保持のみ。実際の損益分岐点・利益予測の計算には上記「変動費率」の値が使われます。</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
          {VARIABLE_RATE_FIELDS.map((f) => (
            <NumberField
              key={f.key}
              label={f.label}
              value={variableRates[f.key] ?? ''}
              onChange={(v) => setVariableRates((prev) => ({ ...prev, [f.key]: v }))}
            />
          ))}
        </div>
      </section>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button
          type="submit"
          disabled={isSaving}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 20px', borderRadius: '12px',
            border: 'none', background: '#D98292', color: '#fff', fontSize: '13px', fontWeight: 700,
            cursor: isSaving ? 'default' : 'pointer', opacity: isSaving ? 0.6 : 1,
          }}
        >
          <Save size={14} />
          {isSaving ? '保存中...' : '保存する'}
        </button>
        {saveSuccess && (
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: '#34D399' }}>
            <CheckCircle2 size={14} /> 保存しました
          </span>
        )}
        {saveError && (
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: '#D14F4F' }}>
            <AlertCircle size={14} /> 保存に失敗しました: {saveError}
          </span>
        )}
      </div>
    </form>
  )
}
