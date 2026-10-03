'use client'
/**
 * useIndependentZoomPan.ts — 並列比較(sideBySide)専用の「1枚ごとに独立したズーム・パン」。
 *
 * useSyncedZoomPan(スライダー用、2枚に同一transformを適用)とは別物で、そちらは変更しない。
 * このフックを写真ごとに1回ずつ呼ぶと、scale/tx/ty・ポインタ管理・ピンチ・ダブルタップ・
 * pointer captureが写真ごとに完全に独立する(状態はフックのインスタンス内のコントローラに閉じる)。
 *
 * ジェスチャー(詳細・計算は src/lib/photos/independentZoomPan.ts):
 *   - 2本指ピンチ: 開始時の中点を基準にズーム、中点の移動はパンとして反映。
 *   - 1本指ドラッグ: 拡大中のみパン(ピンチ後に残った1本でも継続)。等倍ではパン不可。
 *   - ダブルタップ: 等倍→タップ位置基準で2.5倍 / 拡大中→1倍(tx=ty=0)。
 *   - パン範囲: 操作領域の実寸 × objectFit:contain後の実表示サイズ基準(固定値は使わない)。
 *
 * 呼び出し側: handlersを操作領域のdiv(touchAction:none)へ、styleを<img>へ適用し、
 * <img>のonLoadでsetNaturalSize(naturalWidth, naturalHeight)を呼ぶ(contain後の実表示サイズ算出用)。
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import {
  ZOOMED_EPSILON,
  INITIAL_ZOOM_PAN_STATE,
  createZoomPanController,
  type ZoomPanController,
  type ZoomPanState,
} from '@/lib/photos/independentZoomPan'

export interface UseIndependentZoomPanResult {
  /** <img>へ適用するstyle(transform-origin: 0 0 前提の計算)。 */
  style: { transform: string; transformOrigin: string }
  /** 操作領域のルート要素へ付けるpointerイベントハンドラ一式。 */
  handlers: {
    onPointerDown: (e: React.PointerEvent) => void
    onPointerMove: (e: React.PointerEvent) => void
    onPointerUp: (e: React.PointerEvent) => void
    onPointerCancel: (e: React.PointerEvent) => void
  }
  /** ズーム・パン・ジェスチャー状態をすべて初期化する(写真が変わった時など)。 */
  reset: () => void
  /** <img>のonLoadから呼ぶ。contain後の実表示サイズの算出に使う。 */
  setNaturalSize: (width: number, height: number) => void
  isZoomed: boolean
}

export function useIndependentZoomPan(): UseIndependentZoomPanResult {
  const [state, setState] = useState<ZoomPanState>(INITIAL_ZOOM_PAN_STATE)
  const controllerRef = useRef<ZoomPanController | null>(null)
  if (controllerRef.current === null) controllerRef.current = createZoomPanController(setState)
  const controller = controllerRef.current

  const sample = (e: React.PointerEvent) => {
    const rect = (e.currentTarget as Element).getBoundingClientRect()
    return {
      sample: { id: e.pointerId, x: e.clientX - rect.left, y: e.clientY - rect.top, time: Date.now() },
      box: { width: rect.width, height: rect.height },
    }
  }

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    const { sample: s, box } = sample(e)
    controller.pointerDown(s, box)
  }, [controller])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const { sample: s, box } = sample(e)
    controller.pointerMove(s, box)
  }, [controller])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const { sample: s, box } = sample(e)
    controller.pointerUp(s, box)
  }, [controller])

  const onPointerCancel = useCallback((e: React.PointerEvent) => {
    controller.pointerCancel(e.pointerId)
  }, [controller])

  const handlers = useMemo(
    () => ({ onPointerDown, onPointerMove, onPointerUp, onPointerCancel }),
    [onPointerDown, onPointerMove, onPointerUp, onPointerCancel],
  )

  const reset = useCallback(() => controller.reset(), [controller])
  const setNaturalSize = useCallback(
    (width: number, height: number) => controller.setNaturalSize(width > 0 && height > 0 ? { width, height } : null),
    [controller],
  )

  const style = useMemo(
    () => ({
      transform: `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`,
      transformOrigin: '0 0',
    }),
    [state],
  )

  return { style, handlers, reset, setNaturalSize, isZoomed: state.scale > ZOOMED_EPSILON }
}
