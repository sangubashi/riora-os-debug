'use client'
/**
 * useDeviceTilt.ts — 写真カルテ Phase 2(水平器/ジャイロガイド)のDeviceOrientationEvent
 * バインディング。判定ロジック本体はsrc/lib/photos/tiltGuide.tsの純粋関数に委譲する
 * (useFaceGuide.tsと同じ設計思想)。
 *
 * iOS(iPadOS含む) Safari 13+では`DeviceOrientationEvent.requestPermission()`が必要で、
 * かつ**ユーザーの直接のタップ操作の中で同期的に呼び出さないと拒否される**
 * (useEffect起点では動かない)。そのため`requestPermission()`を呼び出し側(モーダルの
 * 「撮影する」導線などユーザー操作の直後)へ公開し、このフック自身では自動的に
 * リクエストしない。Android/デスクトップ等、権限APIが無い環境ではリクエスト不要で
 * そのままイベントを購読できる(requestPermission()は何もせずgranted相当を返す)。
 *
 * 校正方針: beta/gammaの絶対値は機種・画面の向きで意味が変わり実機なしでは校正できない
 * ため、ガイド開始時点(active=trueになった瞬間の最初のサンプル)を基準姿勢として記録し、
 * そこからの相対的なズレのみを見る(tiltGuide.tsのコメント参照)。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  computeTiltDeviation,
  evaluateTiltLevel,
  type DeviceOrientationSample,
  type TiltDeviation,
  type TiltLevelStatus,
} from '@/lib/photos/tiltGuide'

export type TiltPermissionState = 'unsupported' | 'unrequested' | 'granted' | 'denied'

interface DeviceOrientationEventIOS {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

export interface UseDeviceTiltResult {
  permission: TiltPermissionState
  /** iOS13+では直接のタップ操作(onClickハンドラ内)から同期的に呼び出すこと。 */
  requestPermission: () => Promise<void>
  level: TiltLevelStatus
  deviation: TiltDeviation
  /** 現在の姿勢を新たな基準姿勢として取り直す(構え直した場合の再校正用)。 */
  resetBaseline: () => void
}

function isOrientationEventSupported(): boolean {
  return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window
}

function needsIOSPermission(): boolean {
  if (!isOrientationEventSupported()) return false
  const ctor = window.DeviceOrientationEvent as unknown as DeviceOrientationEventIOS
  return typeof ctor.requestPermission === 'function'
}

export function useDeviceTilt(active: boolean): UseDeviceTiltResult {
  const [permission, setPermission] = useState<TiltPermissionState>(() => {
    if (!isOrientationEventSupported()) return 'unsupported'
    return needsIOSPermission() ? 'unrequested' : 'granted'
  })
  const [current, setCurrent] = useState<DeviceOrientationSample>({ beta: null, gamma: null })
  const baselineRef = useRef<DeviceOrientationSample | null>(null)

  const requestPermission = useCallback(async () => {
    if (!isOrientationEventSupported()) {
      setPermission('unsupported')
      return
    }
    if (!needsIOSPermission()) {
      setPermission('granted')
      return
    }
    try {
      const ctor = window.DeviceOrientationEvent as unknown as Required<DeviceOrientationEventIOS>
      const result = await ctor.requestPermission()
      setPermission(result === 'granted' ? 'granted' : 'denied')
    } catch {
      setPermission('denied')
    }
  }, [])

  const resetBaseline = useCallback(() => {
    baselineRef.current = null
  }, [])

  // activeがfalseになった、またはpermissionが変わったら基準姿勢を破棄する
  // (次回activeになった時に改めて最初のサンプルを基準として取り直すため)。
  useEffect(() => {
    if (!active) baselineRef.current = null
  }, [active])

  useEffect(() => {
    if (!active || permission !== 'granted') {
      setCurrent({ beta: null, gamma: null })
      return
    }

    const handler = (e: DeviceOrientationEvent) => {
      const sample: DeviceOrientationSample = { beta: e.beta, gamma: e.gamma }
      if (!baselineRef.current) baselineRef.current = sample
      setCurrent(sample)
    }

    window.addEventListener('deviceorientation', handler)
    return () => window.removeEventListener('deviceorientation', handler)
  }, [active, permission])

  const deviation = computeTiltDeviation(current, baselineRef.current ?? { beta: null, gamma: null })
  const level = evaluateTiltLevel(deviation)

  return { permission, requestPermission, level, deviation, resetBaseline }
}
