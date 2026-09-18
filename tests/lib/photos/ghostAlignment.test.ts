// ================================================================
// ghostAlignment.ts — ゴーストの自動位置・サイズ合わせ 単体テスト
//
// 対応: 写真カルテ Phase 2 追加調整(実機フィードバック「自動倍率だけでは調整精度・
// 使い勝手が不十分」対応、2026-09-18)。前身のghostAutoScale.tsを置き換える。
// ================================================================
import { describe, expect, it } from 'vitest'
import {
  computeGhostAlignment,
  GHOST_ALIGNMENT_SCALE_MIN,
  GHOST_ALIGNMENT_SCALE_MAX,
  type GhostFaceDetection,
} from '../../../src/lib/photos/ghostAlignment'

describe('computeGhostAlignment', () => {
  it('クロップの無い正方形フレーム同士なら、顔中心の画面座標差がそのままtranslateになる', () => {
    const box = { width: 1000, height: 1000 }
    const live: GhostFaceDetection = { frame: { width: 1000, height: 1000 }, face: { x: 400, y: 400, width: 200, height: 200 } }
    const ghost: GhostFaceDetection = { frame: { width: 1000, height: 1000 }, face: { x: 300, y: 300, width: 100, height: 100 } }

    const result = computeGhostAlignment(box, live, ghost)
    expect(result).not.toBeNull()
    expect(result!.scale).toBe(2) // live顔高さ200 / ghost顔高さ100
    expect(result!.originX).toBe(350) // ghost顔中心x
    expect(result!.originY).toBe(350)
    expect(result!.translateX).toBe(150) // live顔中心x(500) - ghost顔中心x(350)
    expect(result!.translateY).toBe(150)
  })

  it('object-fit:coverによる縦横クロップを考慮して画面座標を計算する', () => {
    const box = { width: 800, height: 400 } // 横長の枠
    // frame(400x400、正方形)をcoverで800x400の枠に敷くと、横基準(scale=2)で
    // 縦は800にはみ出し、上下(-200ずつ)が枠外にクロップされる。
    const live: GhostFaceDetection = { frame: { width: 400, height: 400 }, face: { x: 100, y: 100, width: 200, height: 200 } }
    const ghost: GhostFaceDetection = { frame: { width: 400, height: 400 }, face: { x: 100, y: 100, width: 200, height: 200 } }

    const result = computeGhostAlignment(box, live, ghost)
    expect(result).not.toBeNull()
    // 同じframe・同じ顔なので倍率差は無く、位置もズレない
    expect(result!.scale).toBe(1)
    expect(result!.translateX).toBe(0)
    expect(result!.translateY).toBe(0)
    // 顔中心(200,200)がscale=2で(400,400)、offsetY=(400-800)/2=-200なので画面y=200
    expect(result!.originX).toBe(400)
    expect(result!.originY).toBe(200)
  })

  it('極端な倍率差はGHOST_ALIGNMENT_SCALE_MIN/MAXでクランプする', () => {
    const box = { width: 1000, height: 1000 }
    const liveBig: GhostFaceDetection = { frame: { width: 1000, height: 1000 }, face: { x: 100, y: 100, width: 800, height: 800 } }
    const ghostSmall: GhostFaceDetection = { frame: { width: 1000, height: 1000 }, face: { x: 450, y: 450, width: 20, height: 20 } }
    expect(computeGhostAlignment(box, liveBig, ghostSmall)!.scale).toBe(GHOST_ALIGNMENT_SCALE_MAX)

    const liveSmall: GhostFaceDetection = { frame: { width: 1000, height: 1000 }, face: { x: 450, y: 450, width: 20, height: 20 } }
    const ghostBig: GhostFaceDetection = { frame: { width: 1000, height: 1000 }, face: { x: 100, y: 100, width: 800, height: 800 } }
    expect(computeGhostAlignment(box, liveSmall, ghostBig)!.scale).toBe(GHOST_ALIGNMENT_SCALE_MIN)
  })

  it('liveがnullならnullを返す', () => {
    const box = { width: 1000, height: 1000 }
    const ghost: GhostFaceDetection = { frame: { width: 1000, height: 1000 }, face: { x: 300, y: 300, width: 100, height: 100 } }
    expect(computeGhostAlignment(box, null, ghost)).toBeNull()
  })

  it('ghostがnullならnullを返す', () => {
    const box = { width: 1000, height: 1000 }
    const live: GhostFaceDetection = { frame: { width: 1000, height: 1000 }, face: { x: 400, y: 400, width: 200, height: 200 } }
    expect(computeGhostAlignment(box, live, null)).toBeNull()
  })

  it('boxのサイズが0以下ならnullを返す', () => {
    const live: GhostFaceDetection = { frame: { width: 1000, height: 1000 }, face: { x: 400, y: 400, width: 200, height: 200 } }
    const ghost: GhostFaceDetection = { frame: { width: 1000, height: 1000 }, face: { x: 300, y: 300, width: 100, height: 100 } }
    expect(computeGhostAlignment({ width: 0, height: 0 }, live, ghost)).toBeNull()
  })

  it('顔ボックスの幅・高さが0以下ならnullを返す', () => {
    const box = { width: 1000, height: 1000 }
    const live: GhostFaceDetection = { frame: { width: 1000, height: 1000 }, face: { x: 400, y: 400, width: 0, height: 0 } }
    const ghost: GhostFaceDetection = { frame: { width: 1000, height: 1000 }, face: { x: 300, y: 300, width: 100, height: 100 } }
    expect(computeGhostAlignment(box, live, ghost)).toBeNull()
  })
})
