'use client'
/**
 * useLongPress.ts — 長押し検出(お客様モード「終了」ボタンの誤操作防止・2026-09-20ユーザー承認)。
 *
 * お客様に見せている画面からスタッフ専用情報(CustomerBottomSheet)へ誤って戻ってしまうのを
 * 防ぐため、通常のタップ(判定時間未満でpointerupする)では何も起きないようにする。
 * 判定時間(既定600ms)以上押し続けるとonLongPressを呼ぶ。Pointer Eventsのみで実装し、
 * マウス・タッチの両方を1本のハンドラで扱う(usePinchZoom.tsと同じ「外部ライブラリを
 * 追加しない」方針)。
 */
import { useCallback, useRef, useState } from 'react'

const DEFAULT_DURATION_MS = 600
const PROGRESS_TICK_MS = 16

export interface LongPressResult {
  /** 0(未押下)〜1(判定完了直前)の押下進捗。リング等の視覚フィードバックに使う。 */
  progress: number
  pressing: boolean
  handlers: {
    onPointerDown: (e: React.PointerEvent) => void
    onPointerUp: (e: React.PointerEvent) => void
    onPointerLeave: (e: React.PointerEvent) => void
    onPointerCancel: (e: React.PointerEvent) => void
  }
}

export function useLongPress(onLongPress: () => void, durationMs = DEFAULT_DURATION_MS): LongPressResult {
  const [progress, setProgress] = useState(0)
  const [pressing, setPressing] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startAtRef = useRef(0)

  const clear = useCallback(() => {
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null }
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    setPressing(false)
    setProgress(0)
  }, [])

  const start = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    setPressing(true)
    startAtRef.current = Date.now()
    intervalRef.current = setInterval(() => {
      setProgress(Math.min(1, (Date.now() - startAtRef.current) / durationMs))
    }, PROGRESS_TICK_MS)
    timeoutRef.current = setTimeout(() => {
      clear()
      onLongPress()
    }, durationMs)
  }, [durationMs, onLongPress, clear])

  return {
    progress,
    pressing,
    handlers: {
      onPointerDown: start,
      onPointerUp: clear,
      onPointerLeave: clear,
      onPointerCancel: clear,
    },
  }
}
