'use client'
/**
 * SignaturePad.tsx — 契約書の署名パッド(Pointer Events、2026-10-02)。
 *
 * useFacialSchemaCanvas.ts と同じ方式: Apple Pencil(pointerType='pen')優先・手のひら(touch)無視の
 * パームリジェクション判定(decidePointerDown/decidePointerEnd)をそのまま再利用し、
 * touch-action:none、高DPI(devicePixelRatio)対応。指・Apple Pencil・マウスで書ける。
 *
 * 署名は透明背景のPNG(書いた範囲に余白付きでトリミング)として toPngBlob() で取り出す。
 * ストロークはコンポーネント内のrefに持ち、描画中はsetStateしない(再レンダリング負荷を避ける)。
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import {
  INITIAL_POINTER_TRACK_STATE, decidePointerDown, decidePointerEnd, type PointerTrackState,
} from '@/lib/facialSchema/useFacialSchemaCanvas'
import { PALETTE } from '@/components/customer/shared/PhotoCompareKit'

interface Pt { x: number; y: number }

export interface SignaturePadHandle {
  clear: () => void
  undo: () => void
  /** 書いた範囲を余白付きで切り出した透明背景PNG。何も書かれていなければnull。 */
  toPngBlob: () => Promise<Blob | null>
}

interface Props {
  height?: number
  onInkChange?: (hasInk: boolean) => void
}

const INK = '#1a1a1a'
const LINE_WIDTH = 2.8
const EXPORT_SCALE = 2
const EXPORT_PADDING = 8

function drawStroke(ctx: CanvasRenderingContext2D, pts: Pt[]) {
  if (pts.length === 0) return
  ctx.beginPath()
  if (pts.length === 1) {
    ctx.arc(pts[0].x, pts[0].y, LINE_WIDTH / 2, 0, Math.PI * 2)
    ctx.fillStyle = INK
    ctx.fill()
    return
  }
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length - 1; i++) {
    const midX = (pts[i].x + pts[i + 1].x) / 2
    const midY = (pts[i].y + pts[i + 1].y) / 2
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY)
  }
  const last = pts[pts.length - 1]
  ctx.lineTo(last.x, last.y)
  ctx.stroke()
}

function setupCtx(ctx: CanvasRenderingContext2D) {
  ctx.strokeStyle = INK
  ctx.lineWidth = LINE_WIDTH
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
}

const SignaturePad = forwardRef<SignaturePadHandle, Props>(function SignaturePad({ height = 220, onInkChange }, ref) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const strokesRef = useRef<Pt[][]>([])
  const currentRef = useRef<Pt[] | null>(null)
  const trackRef = useRef<PointerTrackState>(INITIAL_POINTER_TRACK_STATE)
  const sizeRef = useRef({ w: 0, h: 0 })
  // 描画中の差分描画用: 直前に描き終えた曲線の終点(ストロークごとに全再描画しない)。
  const lastMidRef = useRef<Pt | null>(null)
  const [hasInk, setHasInk] = useState(false)

  const notify = useCallback((next: boolean) => {
    setHasInk(prev => (prev === next ? prev : next))
    onInkChange?.(next)
  }, [onInkChange])

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, sizeRef.current.w, sizeRef.current.h)
    setupCtx(ctx)
    for (const s of strokesRef.current) drawStroke(ctx, s)
    if (currentRef.current) drawStroke(ctx, currentRef.current)
  }, [])

  // 実寸に合わせて高DPIのバッキングストアを作る(幅の変化に追従)。
  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return undefined
    const resize = () => {
      const w = wrap.clientWidth
      const dpr = window.devicePixelRatio || 1
      sizeRef.current = { w, h: height }
      canvas.width = Math.max(1, Math.round(w * dpr))
      canvas.height = Math.max(1, Math.round(height * dpr))
      canvas.style.width = `${w}px`
      canvas.style.height = `${height}px`
      redraw()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [height, redraw])

  const pointOf = (e: { clientX: number; clientY: number }): Pt => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const decision = decidePointerDown(trackRef.current, e.pointerId, e.pointerType)
    trackRef.current = decision.nextState
    if (decision.action === 'cancel_active_and_ignore') {
      currentRef.current = null // 手のひら等の疑い: 進行中のストロークを捨てる
      redraw()
      return
    }
    if (decision.action !== 'start') return
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const start = pointOf(e)
    currentRef.current = [start]
    lastMidRef.current = start
    // 以降は追加された区間だけを描く(redrawは使わない)。描画状態(DPR変換・線の太さ等)をここで整える。
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx) {
      const dpr = window.devicePixelRatio || 1
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      setupCtx(ctx)
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (trackRef.current.activePointerId !== e.pointerId || !currentRef.current) return
    e.preventDefault()
    const native = e.nativeEvent as PointerEvent
    const events = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : []
    const ctx = canvasRef.current?.getContext('2d')
    const pts = currentRef.current
    for (const ev of events.length > 0 ? events : [native]) {
      const p = pointOf(ev)
      const prev = pts[pts.length - 1]
      pts.push(p)
      if (!ctx || !lastMidRef.current) continue
      // drawStrokeと同じ中点補間のquadratic曲線を、新しい区間の分だけ描く
      const mid = { x: (prev.x + p.x) / 2, y: (prev.y + p.y) / 2 }
      ctx.beginPath()
      ctx.moveTo(lastMidRef.current.x, lastMidRef.current.y)
      ctx.quadraticCurveTo(prev.x, prev.y, mid.x, mid.y)
      ctx.stroke()
      lastMidRef.current = mid
    }
  }

  const finish = (e: React.PointerEvent<HTMLCanvasElement>, commit: boolean) => {
    const decision = decidePointerEnd(trackRef.current, e.pointerId)
    trackRef.current = decision.nextState
    if (!decision.isActivePointer) return
    const done = currentRef.current
    currentRef.current = null
    lastMidRef.current = null
    if (commit && done && done.length > 0) {
      strokesRef.current = [...strokesRef.current, done]
      notify(true)
      // 最後の区間(最終点まで)と、1点だけのタップ(点)を仕上げる。差分描画では全体の描き直しは不要。
      const ctx = canvasRef.current?.getContext('2d')
      if (ctx) {
        if (done.length === 1) {
          drawStroke(ctx, done)
        } else {
          const last = done[done.length - 1]
          const prevMid = { x: (done[done.length - 2].x + last.x) / 2, y: (done[done.length - 2].y + last.y) / 2 }
          ctx.beginPath()
          ctx.moveTo(prevMid.x, prevMid.y)
          ctx.lineTo(last.x, last.y)
          ctx.stroke()
        }
      }
    } else {
      redraw() // 取り消された(手のひら疑い・キャンセル)途中のストロークを消す
    }
  }

  useImperativeHandle(ref, () => ({
    clear: () => {
      strokesRef.current = []
      currentRef.current = null
      redraw()
      notify(false)
    },
    undo: () => {
      strokesRef.current = strokesRef.current.slice(0, -1)
      redraw()
      notify(strokesRef.current.length > 0)
    },
    toPngBlob: async () => {
      const strokes = strokesRef.current
      if (strokes.length === 0) return null
      const all = strokes.flat()
      const pad = EXPORT_PADDING + LINE_WIDTH
      const minX = Math.min(...all.map(p => p.x)) - pad
      const minY = Math.min(...all.map(p => p.y)) - pad
      const w = Math.max(40, Math.max(...all.map(p => p.x)) + pad - minX)
      const h = Math.max(20, Math.max(...all.map(p => p.y)) + pad - minY)
      const out = document.createElement('canvas')
      out.width = Math.ceil(w * EXPORT_SCALE)
      out.height = Math.ceil(h * EXPORT_SCALE)
      const ctx = out.getContext('2d')
      if (!ctx) return null
      ctx.setTransform(EXPORT_SCALE, 0, 0, EXPORT_SCALE, -minX * EXPORT_SCALE, -minY * EXPORT_SCALE)
      setupCtx(ctx)
      for (const s of strokes) drawStroke(ctx, s)
      return new Promise<Blob | null>(resolve => out.toBlob(b => resolve(b), 'image/png'))
    },
  }), [notify, redraw])

  return (
    <div
      ref={wrapRef}
      style={{
        position: 'relative', width: '100%', height: `${height}px`, background: '#fff',
        border: `1.5px solid ${PALETTE.border}`, borderRadius: '12px', overflow: 'hidden',
      }}
    >
      <canvas
        ref={canvasRef}
        data-testid="signature-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={e => finish(e, true)}
        onPointerCancel={e => finish(e, false)}
        style={{ display: 'block', touchAction: 'none', cursor: 'crosshair' }}
      />
      {!hasInk && (
        <p style={{
          position: 'absolute', inset: 0, margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: PALETTE.muted, fontSize: '14px', pointerEvents: 'none',
        }}>
          ここに指またはApple Pencilで署名してください
        </p>
      )}
      <div style={{ position: 'absolute', left: '16px', right: '16px', bottom: '32px', borderBottom: `1px dashed ${PALETTE.border}`, pointerEvents: 'none' }} />
    </div>
  )
})

export default SignaturePad
