'use client'
/**
 * useSyncedZoomPan.ts — 写真カルテ Before/After比較UIの「ズーム・パン」。
 *
 * Pointer Events APIで指の動きを見るだけの汎用フックで、写真固有の知識は持たない。
 * 返された`style`を<img>(または直近の親)へ適用し、`handlers`を操作領域のルート要素へ付ける。
 *
 * 独立ズーム: 呼び出しごとに完全に独立した状態・ポインタ管理を持つため、並列比較では左右で
 * 別々に呼べば「左だけ拡大」「右だけ拡大」ができる(スライダー比較では1つを共有する)。
 * ポインタは操作を開始した領域にsetPointerCaptureされるため、片方の領域の指がもう片方の
 * 領域のジェスチャーに混ざることはない。
 *
 * 対応ジェスチャー:
 *   - 2本指ピンチ: 2本の指の中点を基準に拡大縮小(指の下の内容が動かない)。ピンチ中の
 *     中点の移動はそのままパンになる。
 *   - 1本指ドラッグ: 拡大中(scale>1)だけパン。等倍の間は何もしない(スライダーの
 *     ハンドル操作と競合させないため。ハンドルは別要素で独自にpointerを処理する)。
 *   - ダブルタップ: 等倍ならタップ位置を中心にDOUBLE_TAP_SCALE倍へ拡大、拡大中なら等倍へ戻す。
 *
 * パン範囲は操作領域の実寸から計算し、画像が領域の外へ飛び出し過ぎないようにする。
 * 再描画(再レイアウト)を伴わない transform: translate()/scale() のみを使う。
 */
import { useCallback, useMemo, useRef, useState } from 'react'

export const ZOOM_MIN_SCALE = 1
export const ZOOM_MAX_SCALE = 4
export const DOUBLE_TAP_SCALE = 2.5
const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_SLOP_PX = 40
/** この距離(px)以上動いたらタップではなくドラッグ扱い(ダブルタップ判定から外す)。 */
const TAP_MOVE_SLOP_PX = 8

export interface SyncedZoomPanState {
  scale: number
  tx: number
  ty: number
}

export interface UseSyncedZoomPanResult {
  /** <img>へ適用するstyle(transform-origin込み)。 */
  style: { transform: string; transformOrigin: string }
  /** 操作領域のルート要素へ付けるpointerイベントハンドラ一式。 */
  handlers: {
    onPointerDown: (e: React.PointerEvent) => void
    onPointerMove: (e: React.PointerEvent) => void
    onPointerUp: (e: React.PointerEvent) => void
    onPointerCancel: (e: React.PointerEvent) => void
  }
  reset: () => void
  isZoomed: boolean
  scale: number
}

interface Pt { x: number; y: number }
interface Rect { left: number; top: number; width: number; height: number }

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/** 拡大率に応じたパン可能範囲(領域の中心からの最大ずれ)。 */
export function panBound(scale: number, size: number): number {
  return Math.max(0, ((scale - 1) * size) / 2)
}

/**
 * 領域中心を原点とした点 focal(中心からの相対座標)の下の内容を動かさずに
 * scale を s0→s1 へ変えたときの新しい平行移動量。
 * (transform-origin: center の translate(t) scale(s) では 画面位置 = t + s*p)
 */
export function zoomAround(t0: Pt, s0: number, s1: number, focal: Pt): Pt {
  const k = s1 / s0
  return { x: focal.x - k * (focal.x - t0.x), y: focal.y - k * (focal.y - t0.y) }
}

export function useSyncedZoomPan(): UseSyncedZoomPanResult {
  const [state, setState] = useState<SyncedZoomPanState>({ scale: 1, tx: 0, ty: 0 })
  const stateRef = useRef(state)
  stateRef.current = state

  const pointersRef = useRef<Map<number, Pt>>(new Map())
  const rectRef = useRef<Rect>({ left: 0, top: 0, width: 1, height: 1 })
  const pinchStartRef = useRef<{ distance: number; scale: number; mid: Pt; t: Pt } | null>(null)
  const panStartRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)
  const lastTapRef = useRef<{ at: number; x: number; y: number } | null>(null)
  const downPosRef = useRef<Pt | null>(null)
  const movedRef = useRef(false)
  // ダブルタップを成立させた2回目のタップは、次のダブルタップの1回目として数えない(三連打の誤判定防止)。
  const doubleTapDoneRef = useRef(false)

  const commit = useCallback((next: SyncedZoomPanState) => {
    const r = rectRef.current
    const scale = clamp(next.scale, ZOOM_MIN_SCALE, ZOOM_MAX_SCALE)
    const bx = panBound(scale, r.width)
    const by = panBound(scale, r.height)
    const tx = scale <= 1 ? 0 : clamp(next.tx, -bx, bx)
    const ty = scale <= 1 ? 0 : clamp(next.ty, -by, by)
    setState({ scale, tx, ty })
  }, [])

  const reset = useCallback(() => {
    setState({ scale: 1, tx: 0, ty: 0 })
  }, [])

  const rel = (p: Pt): Pt => {
    const r = rectRef.current
    return { x: p.x - (r.left + r.width / 2), y: p.y - (r.top + r.height / 2) }
  }
  const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y)

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const el = e.currentTarget as Element
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    const b = el.getBoundingClientRect()
    rectRef.current = { left: b.left, top: b.top, width: b.width || 1, height: b.height || 1 }
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointersRef.current.size === 2) {
      // ピンチ開始。パン・ダブルタップ判定は打ち切る。
      panStartRef.current = null
      lastTapRef.current = null
      movedRef.current = true
      const [a, c] = Array.from(pointersRef.current.values())
      pinchStartRef.current = {
        distance: dist(a, c) || 1,
        scale: stateRef.current.scale,
        mid: rel(mid(a, c)),
        t: { x: stateRef.current.tx, y: stateRef.current.ty },
      }
      return
    }

    if (pointersRef.current.size === 1) {
      downPosRef.current = { x: e.clientX, y: e.clientY }
      movedRef.current = false
      const last = lastTapRef.current
      const now = Date.now()
      if (last && now - last.at < DOUBLE_TAP_MS && Math.hypot(e.clientX - last.x, e.clientY - last.y) < DOUBLE_TAP_SLOP_PX) {
        lastTapRef.current = null
        doubleTapDoneRef.current = true
        const s = stateRef.current
        if (s.scale > 1.01) {
          reset()
        } else {
          const t = zoomAround({ x: s.tx, y: s.ty }, s.scale, DOUBLE_TAP_SCALE, rel({ x: e.clientX, y: e.clientY }))
          commit({ scale: DOUBLE_TAP_SCALE, tx: t.x, ty: t.y })
        }
        panStartRef.current = null
        return
      }
      if (stateRef.current.scale > 1.01) {
        panStartRef.current = { x: e.clientX, y: e.clientY, tx: stateRef.current.tx, ty: stateRef.current.ty }
      }
    }
  }, [commit, reset])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!pointersRef.current.has(e.pointerId)) return
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointersRef.current.size === 2 && pinchStartRef.current) {
      const [a, c] = Array.from(pointersRef.current.values())
      const start = pinchStartRef.current
      const s1 = clamp(start.scale * (dist(a, c) / start.distance), ZOOM_MIN_SCALE, ZOOM_MAX_SCALE)
      // 開始時の中点の下にあった内容が、現在の中点の下に来るようにする(拡大+パン)。
      const m = rel(mid(a, c))
      const k = s1 / start.scale
      commit({ scale: s1, tx: m.x - k * (start.mid.x - start.t.x), ty: m.y - k * (start.mid.y - start.t.y) })
      return
    }

    if (pointersRef.current.size === 1) {
      const d = downPosRef.current
      if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_MOVE_SLOP_PX) movedRef.current = true
      const ps = panStartRef.current
      if (ps) {
        commit({
          scale: stateRef.current.scale,
          tx: ps.tx + (e.clientX - ps.x),
          ty: ps.ty + (e.clientY - ps.y),
        })
      }
    }
  }, [commit])

  const endPointer = useCallback((e: React.PointerEvent) => {
    const wasSingle = pointersRef.current.size === 1
    pointersRef.current.delete(e.pointerId)
    if (pointersRef.current.size < 2) pinchStartRef.current = null
    if (pointersRef.current.size < 1) panStartRef.current = null
    // ピンチ後に残った1本の指でそのままパンを続けられるよう、基準を取り直す。
    if (pointersRef.current.size === 1 && stateRef.current.scale > 1.01) {
      const [p] = Array.from(pointersRef.current.values())
      panStartRef.current = { x: p.x, y: p.y, tx: stateRef.current.tx, ty: stateRef.current.ty }
    }
    // ほとんど動かさずに離した1本指だけを「タップ」として記録(ダブルタップ判定用)。
    if (doubleTapDoneRef.current) {
      doubleTapDoneRef.current = false
    } else if (wasSingle && !movedRef.current && e.type === 'pointerup') {
      lastTapRef.current = { at: Date.now(), x: e.clientX, y: e.clientY }
    }
  }, [])

  const handlers = useMemo(() => ({
    onPointerDown,
    onPointerMove,
    onPointerUp: endPointer,
    onPointerCancel: endPointer,
  }), [onPointerDown, onPointerMove, endPointer])

  const style = useMemo(() => ({
    transform: `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`,
    transformOrigin: 'center center',
  }), [state])

  return { style, handlers, reset, isZoomed: state.scale > 1.01, scale: state.scale }
}
