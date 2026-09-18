'use client'
/**
 * useGhostImageFaceDetection.ts — ゴースト静止画に対する一度きりの顔検出
 * (写真カルテ Phase 2 追加調整・ゴーストの自動位置・サイズ合わせ、2026-09-18)。
 *
 * useFaceGuide.tsはライブ映像(VIDEO runningMode)を継続的に推論するのに対し、
 * こちらはゴースト写真(静止画)を1回だけ推論するための別インスタンス
 * (runningMode: 'IMAGE')。同じモデル(blaze_face_short_range.tflite)・同じ
 * WASMランタイムを使うが、VIDEO側の推論ループとタイムスタンプを共有しない
 * ようインスタンスを分離する(runningModeはインスタンス生成時に固定されるため)。
 *
 * ゴースト写真は静止画なので顔の位置・大きさは変わらない(1回検出すれば十分)。
 * 呼び出し側(ghostAlignment.ts の computeGhostRingAlignment)がこの結果を、既存の
 * 顔検出ガイド(丸い輪)が前提とする固定ターゲットに合わせるための変換に使う
 * (ライブ映像の検出結果には依存しない。継続追従はジッターの原因だったため廃止した)。
 *
 * ベストエフォート実装: 画像の読み込み失敗・CORS制限・モデル未対応等どの理由で
 * 失敗してもnullを返すだけで例外を投げない(自動位置・サイズ合わせが効かないだけで、
 * 既存の手動サイズスライダーで引き続き調整できるため)。
 */
import { useEffect, useState } from 'react'

const WASM_BASE_PATH = '/mediapipe/wasm'
const MODEL_PATH = '/mediapipe/models/blaze_face_short_range.tflite'

type FaceDetectorInstance = import('@mediapipe/tasks-vision').FaceDetector

let imageDetectorPromise: Promise<FaceDetectorInstance> | null = null

function loadImageFaceDetector(): Promise<FaceDetectorInstance> {
  if (!imageDetectorPromise) {
    imageDetectorPromise = (async () => {
      const { FilesetResolver, FaceDetector } = await import('@mediapipe/tasks-vision')
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE_PATH)
      return FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'CPU' },
        runningMode: 'IMAGE',
      })
    })().catch(err => {
      imageDetectorPromise = null
      throw err
    })
  }
  return imageDetectorPromise
}

export interface GhostImageFaceSample {
  frame: { width: number; height: number }
  face: { x: number; y: number; width: number; height: number }
}

/**
 * ゴースト写真のURLが変わるたびに1回だけ顔検出を実行し、結果(顔ボックス・画像解像度、
 * いずれもネイティブ座標系)を返す。urlがnullの間、または検出できなかった場合はnull。
 */
export function useGhostImageFaceDetection(url: string | null): GhostImageFaceSample | null {
  const [sample, setSample] = useState<GhostImageFaceSample | null>(null)

  useEffect(() => {
    if (!url) {
      setSample(null)
      return undefined
    }

    let cancelled = false
    setSample(null)

    const img = new Image()
    img.crossOrigin = 'anonymous'

    img.onload = () => {
      if (cancelled) return
      loadImageFaceDetector()
        .then(detector => {
          if (cancelled) return
          const result = detector.detect(img)
          const box = result.detections[0]?.boundingBox
          if (box && img.naturalWidth > 0 && img.naturalHeight > 0) {
            setSample({
              frame: { width: img.naturalWidth, height: img.naturalHeight },
              face: { x: box.originX, y: box.originY, width: box.width, height: box.height },
            })
          } else {
            setSample(null)
          }
        })
        .catch(() => {
          if (!cancelled) setSample(null)
        })
    }
    img.onerror = () => {
      if (!cancelled) setSample(null)
    }
    img.src = url

    return () => {
      cancelled = true
    }
  }, [url])

  return sample
}
