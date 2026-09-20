'use client'
/**
 * useLongPress.ts — 長押し検出(お客様モード「終了」ボタンの誤操作防止・2026-09-20ユーザー承認)。
 *
 * お客様に見せている画面からスタッフ専用情報(CustomerBottomSheet)へ誤って戻ってしまうのを
 * 防ぐため、通常のタップ(判定時間未満でpointerupする)では何も起きないようにする。
 * 判定時間(既定600ms)以上押し続けるとonLongPressを呼ぶ。Pointer Eventsのみで実装し、
 * マウス・タッチの両方を1本のハンドラで扱う(usePinchZoom.tsと同じ「外部ライブラリを
 * 追加しない」方針)。
 *
 * 移動キャンセル(PHASE IPAD-KARTE-ENTRY-1・2026-09-20ユーザー承認): 第3引数
 * `options.moveCancelPx`を指定した場合のみ、pointerdown位置から指定px以上動いたら
 * 自動的にキャンセルする(スクロール等の誤発動防止)。**完全にオプトイン**であり、
 * `options`を渡さない既存呼び出し元(お客様モード「終了」ボタン、durationMsのみ指定)の
 * 挙動には一切影響しない。
 */
import { useCallback, useRef, useState } from 'react'

const DEFAULT_DURATION_MS = 600
const PROGRESS_TICK_MS = 16

export interface UseLongPressOptions {
  /** pointerdown位置からこのpx数以上動いたら自動キャンセルする。未指定なら移動判定自体を行わない。 */
  moveCancelPx?: number
}

export interface LongPressResult {
  /** 0(未押下)〜1(判定完了直前)の押下進捗。リング等の視覚フィードバックに使う。 */
  progress: number
  pressing: boolean
  handlers: {
    onPointerDown: (e: React.PointerEvent) => void
    onPointerMove: (e: React.PointerEvent) => void
    onPointerUp: (e: React.PointerEvent) => void
    onPointerLeave: (e: React.PointerEvent) => void
    onPointerCancel: (e: React.PointerEvent) => void
  }
}

export function useLongPress(
  onLongPress: () => void,
  durationMs = DEFAULT_DURATION_MS,
  options?: UseLongPressOptions
): LongPressResult {
  const [progress, setProgress] = useState(0)
  const [pressing, setPressing] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startAtRef = useRef(0)
  const startPosRef = useRef<{ x: number; y: number } | null>(null)
  const moveCancelPx = options?.moveCancelPx

  const clear = useCallback(() => {
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null }
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    startPosRef.current = null
    setPressing(false)
    setProgress(0)
  }, [])

  const start = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    setPressing(true)
    startAtRef.current = Date.now()
    startPosRef.current = moveCancelPx != null ? { x: e.clientX, y: e.clientY } : null
    intervalRef.current = setInterval(() => {
      setProgress(Math.min(1, (Date.now() - startAtRef.current) / durationMs))
    }, PROGRESS_TICK_MS)
    timeoutRef.current = setTimeout(() => {
      clear()
      onLongPress()
    }, durationMs)
  }, [durationMs, onLongPress, clear, moveCancelPx])

  const move = useCallback((e: React.PointerEvent) => {
    if (moveCancelPx == null || !startPosRef.current) return
    const dx = e.clientX - startPosRef.current.x
    const dy = e.clientY - startPosRef.current.y
    if (Math.hypot(dx, dy) > moveCancelPx) clear()
  }, [moveCancelPx, clear])

  return {
    progress,
    pressing,
    handlers: {
      onPointerDown: start,
      onPointerMove: move,
      onPointerUp: clear,
      onPointerLeave: clear,
      onPointerCancel: clear,
    },
  }
}
