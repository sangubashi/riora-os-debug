'use client'
/**
 * useSyncedZoomPan.ts — 写真カルテ Before/After比較UIの「連動ズーム・連動パン」。
 *
 * 2枚の写真に同一のtransform(scale/translate)を適用するための状態管理のみを担う
 * (Pointer Events APIで指の動きを見るだけの汎用フックで、写真固有の知識は持たない)。
 * 呼び出し側は返された`style`をそのまま2枚の<img>(または各レイヤーの直近の親)へ
 * 同一のまま適用することで、「片方だけの拡大・移動」が構造的に起こらないようにする。
 *
 * 対応ジェスチャー:
 *   - 2本指ピンチ: 中心固定でscaleを変える(transform-origin: centerを前提)。
 *   - 1本指ドラッグ: scale>1(拡大中)の間だけパンする。scale===1の間は何もしない
 *     (スライダーの中央ハンドルのドラッグと競合させないため。ハンドル自体は別要素で
 *     独自にpointerdown/moveを処理する)。
 *   - ダブルタップ: scale・pan位置をリセットする(よくある画像ビューアの挙動)。
 *
 * GPU寄り実装の要件(clip-pathまたはtransform)に合わせ、再描画(再レイアウト)を伴わない
 * transform: translate()/scale() のみを使う。
 */
import { useCallback, useMemo, useRef, useState } from 'react'

export const ZOOM_MIN_SCALE = 1
export const ZOOM_MAX_SCALE = 4
const DOUBLE_TAP_MS = 300

export interface SyncedZoomPanState {
  scale: number
  tx: number
  ty: number
}

export interface UseSyncedZoomPanResult {
  /** 2枚の<img>へ同一のまま適用するstyle(transform-origin込み)。 */
  style: { transform: string; transformOrigin: string }
  /** 比較対象コンテナのルート要素へ付けるpointerイベントハンドラ一式。 */
  handlers: {
    onPointerDown: (e: React.PointerEvent) => void
    onPointerMove: (e: React.PointerEvent) => void
    onPointerUp: (e: React.PointerEvent) => void
    onPointerCancel: (e: React.PointerEvent) => void
  }
  reset: () => void
  isZoomed: boolean
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

export function useSyncedZoomPan(): UseSyncedZoomPanResult {
  const [state, setState] = useState<SyncedZoomPanState>({ scale: 1, tx: 0, ty: 0 })
  const stateRef = useRef(state)
  stateRef.current = state

  // 進行中のポインタ(指)をpointerId→座標で管理する。2本になったらピンチ、1本ならパン。
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pinchStartRef = useRef<{ distance: number; scale: number } | null>(null)
  const panStartRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)
  const lastTapRef = useRef<number>(0)

  const reset = useCallback(() => {
    setState({ scale: 1, tx: 0, ty: 0 })
  }, [])

  const distanceOf = (pts: { x: number; y: number }[]): number => {
    const [a, b] = pts
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId)
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointersRef.current.size === 2) {
      // ピンチ開始。パン中だった場合は打ち切る(同時操作はサポートしない、単純さ優先)。
      panStartRef.current = null
      const pts = Array.from(pointersRef.current.values())
      pinchStartRef.current = { distance: distanceOf(pts), scale: stateRef.current.scale }
    } else if (pointersRef.current.size === 1) {
      const now = Date.now()
      if (now - lastTapRef.current < DOUBLE_TAP_MS) {
        reset()
        lastTapRef.current = 0
        return
      }
      lastTapRef.current = now

      if (stateRef.current.scale > 1.01) {
        panStartRef.current = { x: e.clientX, y: e.clientY, tx: stateRef.current.tx, ty: stateRef.current.ty }
      }
    }
  }, [reset])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!pointersRef.current.has(e.pointerId)) return
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointersRef.current.size === 2 && pinchStartRef.current) {
      const pts = Array.from(pointersRef.current.values())
      const dist = distanceOf(pts)
      const ratio = dist / (pinchStartRef.current.distance || 1)
      const nextScale = clamp(pinchStartRef.current.scale * ratio, ZOOM_MIN_SCALE, ZOOM_MAX_SCALE)
      setState(prev => ({ ...prev, scale: nextScale }))
      return
    }

    if (pointersRef.current.size === 1 && panStartRef.current) {
      const dx = e.clientX - panStartRef.current.x
      const dy = e.clientY - panStartRef.current.y
      // scaleが大きいほど動かせる範囲を広げる(ズームしていない状態でパンが残らないよう
      // scale===1ならこの分岐自体に入らない: panStartRef はscale>1の時しか立てないため安全)。
      const bound = (stateRef.current.scale - 1) * 200
      setState(prev => ({
        ...prev,
        tx: clamp(panStartRef.current!.tx + dx, -bound, bound),
        ty: clamp(panStartRef.current!.ty + dy, -bound, bound),
      }))
    }
  }, [])

  const endPointer = useCallback((e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId)
    if (pointersRef.current.size < 2) pinchStartRef.current = null
    if (pointersRef.current.size < 1) panStartRef.current = null
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

  return { style, handlers, reset, isZoomed: state.scale > 1.01 }
}
