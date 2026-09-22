'use client'
/**
 * FacialSchemaSection.tsx — 「🖊 顔シェーマ」編集セクション(Phase 5)。
 *
 * IpadStaffKarteViewの左カラム、KarteMemoSectionの直下に配置する自己完結セクション。
 * PUT /api/customers/[id]/facial-schemas への保存(現在の機会へのupsert)・
 * GET /api/customers/[id]/facial-schemas からの履歴取得・前回シェーマの読み込み(コピー)を
 * 行う。見た目の操作パターン(カード→ボタン→保存/キャンセル)・配色(PALETTE)は
 * KarteMemoSection.tsxを踏襲する。
 *
 * 描画本体(Pointer Events・パームリジェクション・ストローク管理)は
 * src/lib/facialSchema/useFacialSchemaCanvas.tsに、実際のcanvas描画は
 * src/lib/facialSchema/canvasRenderer.tsに委譲する(このファイルはUIの組み立てのみ)。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { RotateCcw, Trash2, Check, History, Eraser } from 'lucide-react'
import { authedFetch } from '@/lib/api/authedFetch'
import { PALETTE, Card } from '@/components/customer/shared/PhotoCompareKit'
import {
  FACIAL_SCHEMA_TEMPLATE_ASPECT_RATIO, FACIAL_SCHEMA_TEMPLATE_SRC, facialSchemaTemplateImgStyle,
  FacialSchemaSubHeading, FacialSchemaThumbnail,
} from '@/components/customer/shared/FacialSchemaKit'
import { useFacialSchemaCanvas } from '@/lib/facialSchema/useFacialSchemaCanvas'
import { renderStroke, renderStrokes, type RenderBox } from '@/lib/facialSchema/canvasRenderer'
import { createEmptyStrokesData } from '@/lib/facialSchema/strokeModel'
import { FACIAL_SCHEMA_COLOR_PALETTE, type FacialSchemaCategory } from '@/lib/facialSchema/facialSchemaCategories'
import { buildPreviousSchema, todayJstDateStr } from '@/lib/facialSchema/facialSchemaSelection'
import type { FacialSchemaApiShape } from '@/lib/facialSchema/facialSchemaApiMapping'

interface Props {
  customerId: string
  /** 本日来店のvisit_id(ipadKarteData.tsのtodayVisitId)。来店記録が無ければnull。 */
  visitId: string | null
  /** 店舗共通ログイン+担当者タグ選択時のみ意味を持つ担当者上書き(KarteMemoSectionと同じ)。 */
  staffIdOverride?: string | null
}

interface FacialSchemasApiResponse {
  success: boolean
  schemas?: FacialSchemaApiShape[]
}

interface FacialSchemaPutResponse {
  success: boolean
  schema?: FacialSchemaApiShape
  created?: boolean
}

function formatDateOnly(dateStr: string): string {
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function FacialSchemaSection({ customerId, visitId, staffIdOverride = null }: Props) {
  const [schemas, setSchemas] = useState<FacialSchemaApiShape[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)
  const [previousOpen, setPreviousOpen] = useState(false)

  const canvas = useFacialSchemaCanvas()
  const canvasElRef    = useRef<HTMLCanvasElement | null>(null)
  const containerElRef = useRef<HTMLDivElement | null>(null)
  const boxSizeRef      = useRef<RenderBox>({ width: 0, height: 0 })

  // loadStrokesDataは(hooks内でuseCallback([])により)参照として安定しているが、
  // 「常に最新のcanvasインスタンスの関数を呼ぶ」ことを保証するためrefで持つ
  // (loadコールバック自体の依存配列にcanvas(毎レンダー新しいオブジェクト)を
  // 含めると無限ループになるため)。
  const loadStrokesDataRef = useRef(canvas.loadStrokesData)
  loadStrokesDataRef.current = canvas.loadStrokesData

  // 依存配列にはcanvas.strokesData(値)とcanvas.getCurrentStroke(useCallback([])で
  // 安定した参照)のみを指定する。canvasオブジェクト自体は毎レンダー新規生成されるため、
  // それを依存配列に含めるとredrawが毎レンダー再生成され、下の再描画effectが
  // strokesData不変時にも余計に走ってしまう。
  const redraw = useCallback(() => {
    const el = canvasElRef.current
    if (!el) return
    const ctx = el.getContext('2d')
    if (!ctx) return
    const box = boxSizeRef.current
    ctx.clearRect(0, 0, box.width, box.height)
    renderStrokes(ctx, canvas.strokesData.strokes, box)
    const current = canvas.getCurrentStroke()
    if (current) renderStroke(ctx, current, box)
  }, [canvas.strokesData, canvas.getCurrentStroke])

  // canvas実寸の追従(高DPI対応)。containerElRefとuseFacialSchemaCanvasのcontainerRefは
  // 同じ要素を指す(下のref callback参照)。
  useEffect(() => {
    const container = containerElRef.current
    const el = canvasElRef.current
    if (!container || !el) return

    const observer = new ResizeObserver(entries => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      const dpr = window.devicePixelRatio || 1
      el.width  = Math.round(width * dpr)
      el.height = Math.round(height * dpr)
      const ctx = el.getContext('2d')
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      boxSizeRef.current = { width, height }
      redraw()
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [redraw])

  // 確定済みストロークが変わるたび(Undo/Clear/コミット/履歴読み込み)に再描画する。
  useEffect(() => { redraw() }, [canvas.strokesData, redraw])

  // 描画中は進行中ストロークのライブプレビューのため、rAFループで再描画し続ける。
  useEffect(() => {
    if (!canvas.isDrawing) return
    let raf = 0
    const loop = () => { redraw(); raf = requestAnimationFrame(loop) }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [canvas.isDrawing, redraw])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await authedFetch(`/api/customers/${customerId}/facial-schemas`)
      if (res.ok) {
        const json = await res.json() as FacialSchemasApiResponse
        const list = json.schemas ?? []
        setSchemas(list)

        const todayStr = todayJstDateStr()
        const existingToday = list.find(s => (
          visitId ? s.visitId === visitId : (s.visitId === null && s.schemaDate === todayStr)
        )) ?? null
        loadStrokesDataRef.current(existingToday ? existingToday.strokesData : createEmptyStrokesData())
        setLastSavedAt(existingToday?.updatedAt ?? null)
      }
    } catch {
      /* 取得失敗時は前回の表示を維持する */
    } finally {
      setLoading(false)
    }
  }, [customerId, visitId])

  useEffect(() => { void load() }, [load])

  const previousSchema = buildPreviousSchema(schemas, visitId, todayJstDateStr())

  async function handleSave() {
    if (saving) return
    setSaving(true)
    setSaveError(null)
    try {
      const res = await authedFetch(`/api/customers/${customerId}/facial-schemas`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitId: visitId ?? null,
          strokesData: canvas.strokesData,
          ...(staffIdOverride ? { staffId: staffIdOverride } : {}),
        }),
      })
      if (!res.ok) throw new Error('save_failed')
      const json = await res.json() as FacialSchemaPutResponse
      setLastSavedAt(json.schema?.updatedAt ?? new Date().toISOString())
      // 保存成功後のデータ自動再取得(履歴・「前回」判定を最新化する)。
      await load()
    } catch {
      setSaveError('保存に失敗しました。もう一度お試しください。')
    } finally {
      setSaving(false)
    }
  }

  function handleLoadPrevious() {
    if (!previousSchema) return
    canvas.loadStrokesData(previousSchema.strokesData)
  }

  return (
    <Card title="🖊 顔シェーマ">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {loading && <p style={{ margin: 0, fontSize: '12px', color: PALETTE.muted }}>読み込み中…</p>}

        {!loading && (
          <>
            {/* 色鉛筆風の原色パレット(2026-09-22ユーザー要望: タブ廃止・原色から直接選択、
                黒/赤必須の8色)+消しゴム。以前はカテゴリ(ニキビ/赤み等)ごとの意味付き
                タブだったが、色そのものを選ぶ方式に変更した。丸いスウォッチをタップする
                だけで選択でき、選択中は太いリングで強調する。消しゴムは色ではないため
                見た目を区別した独立ボタンとして末尾に置く(canvas.setCategory('eraser')を
                呼ぶだけで、フック側の「categoryからtoolを引く」ロジックがそのまま流用され、
                以降のストロークはcanvasRenderer.ts側でdestination-out合成により実際に
                ピクセルを消す)。 */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
              {FACIAL_SCHEMA_COLOR_PALETTE.map(c => {
                const selected = canvas.category === c.category
                return (
                  <button
                    key={c.category}
                    type="button"
                    onClick={() => canvas.setCategory(c.category as FacialSchemaCategory)}
                    aria-label={c.label}
                    aria-pressed={selected}
                    style={{
                      width: '34px', height: '34px', borderRadius: '50%', padding: 0, cursor: 'pointer',
                      background: c.color,
                      border: selected ? `3px solid ${PALETTE.gold}` : '3px solid transparent',
                      boxShadow: selected ? `0 0 0 1px ${PALETTE.border}` : '0 0 0 1px rgba(0,0,0,0.08)',
                    }}
                  />
                )
              })}
              <span style={{ width: '1px', height: '24px', background: PALETTE.border, margin: '0 2px' }} aria-hidden />
              <button
                type="button"
                onClick={() => canvas.setCategory('eraser')}
                aria-pressed={canvas.category === 'eraser'}
                aria-label="消しゴム"
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  fontSize: '12px', fontWeight: 700, padding: '8px 14px', borderRadius: '999px',
                  border: canvas.category === 'eraser' ? `1.5px solid ${PALETTE.text}` : `1px solid ${PALETTE.border}`,
                  background: canvas.category === 'eraser' ? PALETTE.text : PALETTE.card,
                  color: canvas.category === 'eraser' ? '#fff' : PALETTE.text,
                  cursor: 'pointer',
                }}
              >
                <Eraser size={13} />消しゴム
              </button>
            </div>

            {/* 描画キャンバス。2026-09-22ユーザー要望(描画エリア拡大)により、左カラムに
                収まっていた時の実測幅(約380〜450px)より大幅に大きい640pxを上限とし、
                IpadStaffKarteView側で全幅行(gridColumn:'1 / -1')へ移動したことで実際に
                この上限まで使えるようにした。中央寄せして左右の余白を均等にする。 */}
            <div
              ref={el => { canvas.containerRef.current = el; containerElRef.current = el }}
              {...canvas.handlers}
              style={{
                position: 'relative', width: '100%', maxWidth: '640px', margin: '0 auto',
                aspectRatio: FACIAL_SCHEMA_TEMPLATE_ASPECT_RATIO,
                borderRadius: '12px', overflow: 'hidden', border: `1px solid ${PALETTE.border}`,
                background: '#fff', ...canvas.recommendedContainerStyle,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- 固定テンプレート静止画のためnext/imageの最適化は不要 */}
              <img
                src={FACIAL_SCHEMA_TEMPLATE_SRC}
                alt="顔シェーマ(正面)テンプレート"
                draggable={false}
                style={facialSchemaTemplateImgStyle}
              />
              <canvas
                ref={canvasElRef}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
              />
            </div>

            {/* 操作ボタン(元に戻す・全消去・保存) */}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={canvas.undo}
                disabled={!canvas.canUndo}
                style={{
                  display: 'flex', alignItems: 'center', gap: '4px',
                  fontSize: '11px', padding: '6px 12px', borderRadius: '999px',
                  border: `1px solid ${PALETTE.border}`, background: PALETTE.card,
                  color: canvas.canUndo ? PALETTE.text : PALETTE.muted,
                  cursor: canvas.canUndo ? 'pointer' : 'default', opacity: canvas.canUndo ? 1 : 0.5,
                }}
              >
                <RotateCcw size={11} />元に戻す
              </button>
              <button
                type="button"
                onClick={canvas.clear}
                disabled={!canvas.canUndo}
                style={{
                  display: 'flex', alignItems: 'center', gap: '4px',
                  fontSize: '11px', padding: '6px 12px', borderRadius: '999px',
                  border: '1px solid rgba(196,90,90,0.3)', background: 'rgba(196,90,90,0.08)',
                  color: canvas.canUndo ? '#B85050' : PALETTE.muted,
                  cursor: canvas.canUndo ? 'pointer' : 'default', opacity: canvas.canUndo ? 1 : 0.5,
                }}
              >
                <Trash2 size={11} />全消去
              </button>

              <div style={{ flex: 1 }} />

              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving}
                style={{
                  display: 'flex', alignItems: 'center', gap: '4px',
                  fontSize: '11px', fontWeight: 700, padding: '6px 14px', borderRadius: '999px',
                  border: 'none', background: saving ? PALETTE.border : PALETTE.gold, color: '#fff',
                  cursor: saving ? 'default' : 'pointer',
                }}
              >
                <Check size={11} />{saving ? '保存中…' : '保存する'}
              </button>
            </div>

            {saveError && (
              <p style={{ margin: 0, fontSize: '11px', color: '#B85050' }}>{saveError}</p>
            )}
            {!saveError && lastSavedAt && (
              <p style={{ margin: 0, fontSize: '10px', color: PALETTE.muted }}>最終保存: {formatDateTime(lastSavedAt)}</p>
            )}

            {/* 前回のシェーマ(比較参照・コピー) */}
            {previousSchema && (
              <div style={{ border: `1px solid ${PALETTE.border}`, borderRadius: '10px', overflow: 'hidden' }}>
                <button
                  type="button"
                  onClick={() => setPreviousOpen(v => !v)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '10px 12px', border: 'none', background: PALETTE.card,
                    color: PALETTE.gold, fontSize: '12px', fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  <History size={13} />
                  前回のシェーマ
                  <span style={{ fontWeight: 400, color: PALETTE.muted }}>
                    ({formatDateOnly(previousSchema.schemaDate)})
                  </span>
                </button>
                {previousOpen && (
                  <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px', borderTop: `1px solid ${PALETTE.border}` }}>
                    <FacialSchemaSubHeading>今回と見比べながら描き込めます</FacialSchemaSubHeading>
                    <div style={{ maxWidth: '220px' }}>
                      <FacialSchemaThumbnail strokesData={previousSchema.strokesData} />
                    </div>
                    <button
                      type="button"
                      onClick={handleLoadPrevious}
                      style={{
                        alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '6px',
                        fontSize: '12px', fontWeight: 700, padding: '8px 14px', borderRadius: '999px',
                        border: `1.5px dashed ${PALETTE.border}`, background: 'transparent', color: PALETTE.gold,
                        cursor: 'pointer',
                      }}
                    >
                      前回のシェーマを読み込む(コピー)
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  )
}
