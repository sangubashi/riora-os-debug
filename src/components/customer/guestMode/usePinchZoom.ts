'use client'
/**
 * usePinchZoom.ts — 拡大モード専用の軽量ピンチズーム(PHASE GUEST-MODE-3・2026-09-12)。
 *
 * 外部ライブラリを追加せず、touchイベント+CSS transformのみで実装する
 * (二指ピンチでscale、一指ドラッグでpan、ダブルタップでリセットの最小構成)。
 *
 * 【重要】保留中の「比較エンジン(スライダー+連動ズーム)」とは無関係の別実装。
 * ここでの拡大表示は1枚の写真を単独で見るためのものであり、2枚の写真を
 * 連動させてズーム・スライドする機能ではない(混同しないこと)。
 */
import { useCallback, useRef, useState } from 'react'

const MIN_SCALE = 1
const MAX_SCALE = 4
const DOUBLE_TAP_MS = 300

export interface PinchZoomState {
  scale: number
  x: number
  y: number
}

export interface PinchZoomResult extends PinchZoomState {
  reset: () => void
  handlers: {
    onTouchStart: (e: React.TouchEvent) => void
    onTouchMove: (e: React.TouchEvent) => void
    onTouchEnd: (e: React.TouchEvent) => void
  }
}

function touchDistance(touches: React.TouchList): number {
  const a = touches[0]
  const b = touches[1]
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
}

export function usePinchZoom(): PinchZoomResult {
  const [state, setState] = useState<PinchZoomState>({ scale: 1, x: 0, y: 0 })
  const gesture = useRef<{
    startDist: number | null
    startScale: number
    lastPointer: { x: number; y: number } | null
    lastTapAt: number
  }>({ startDist: null, startScale: 1, lastPointer: null, lastTapAt: 0 })

  const reset = useCallback(() => {
    setState({ scale: 1, x: 0, y: 0 })
  }, [])

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      gesture.current.startDist = touchDistance(e.touches)
      setState(s => {
        gesture.current.startScale = s.scale
        return s
      })
    } else if (e.touches.length === 1) {
      const now = Date.now()
      if (now - gesture.current.lastTapAt < DOUBLE_TAP_MS) {
        reset()
      }
      gesture.current.lastTapAt = now
      gesture.current.lastPointer = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    }
  }, [reset])

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && gesture.current.startDist) {
      e.preventDefault()
      const ratio = touchDistance(e.touches) / gesture.current.startDist
      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, gesture.current.startScale * ratio))
      setState(s => ({ ...s, scale: nextScale }))
    } else if (e.touches.length === 1 && gesture.current.lastPointer) {
      setState(s => {
        if (s.scale <= 1) return s
        e.preventDefault()
        const dx = e.touches[0].clientX - gesture.current.lastPointer!.x
        const dy = e.touches[0].clientY - gesture.current.lastPointer!.y
        gesture.current.lastPointer = { x: e.touches[0].clientX, y: e.touches[0].clientY }
        return { ...s, x: s.x + dx, y: s.y + dy }
      })
    }
  }, [])

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 0) {
      gesture.current.startDist = null
      gesture.current.lastPointer = null
      setState(s => (s.scale <= 1.02 ? { scale: 1, x: 0, y: 0 } : s))
    }
  }, [])

  return { ...state, reset, handlers: { onTouchStart, onTouchMove, onTouchEnd } }
}
