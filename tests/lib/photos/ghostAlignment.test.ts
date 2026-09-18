// ================================================================
// ghostAlignment.ts — ゴーストの初期位置・サイズ合わせ 単体テスト
//
// 対応: 実機フィードバックを受けての再設計(2026-09-18)。ライブ映像への継続追従
// (前身、ジッターが問題になった)から、既存の顔検出ガイド基準(faceGuide.tsの
// FACE_GUIDE_SIZE_MIN_RATIO〜MAX_RATIOの中央値・画面中央0.5,0.5)への一度きりの
// 位置合わせに置き換えた。
// ================================================================
import { describe, expect, it } from 'vitest'
import {
  computeGhostRingAlignment,
  GHOST_ALIGNMENT_SCALE_MIN,
  GHOST_ALIGNMENT_SCALE_MAX,
  GHOST_ALIGNMENT_TARGET_HEIGHT_RATIO,
  type GhostFaceDetection,
} from '../../../src/lib/photos/ghostAlignment'

describe('computeGhostRingAlignment', () => {
  it('顔がすでにターゲット比率どおりの大きさ・中心位置ならscale=1・translate=0を返す', () => {
    const box = { width: 1000, height: 1000 }
    const targetHeight = GHOST_ALIGNMENT_TARGET_HEIGHT_RATIO * box.height // = 475
    const ghost: GhostFaceDetection = {
      frame: { width: 1000, height: 1000 },
      face: { x: 500 - targetHeight / 2, y: 500 - targetHeight / 2, width: targetHeight, height: targetHeight },
    }

    const result = computeGhostRingAlignment(box, ghost)
    expect(result).not.toBeNull()
    expect(result!.scale).toBeCloseTo(1)
    expect(result!.translateX).toBeCloseTo(0)
    expect(result!.translateY).toBeCloseTo(0)
  })

  it('顔が小さい場合は拡大し、中心がズレていればtranslateで画面中央へ寄せる', () => {
    const box = { width: 1000, height: 1000 }
    // 顔が(100,100)-(200,200)の小さな矩形(box左上寄り)
    const ghost: GhostFaceDetection = {
      frame: { width: 1000, height: 1000 },
      face: { x: 100, y: 100, width: 100, height: 100 },
    }

    const result = computeGhostRingAlignment(box, ghost)
    expect(result).not.toBeNull()
    // rawScale = 475/100 = 4.75 → GHOST_ALIGNMENT_SCALE_MAXでクランプされる
    expect(result!.scale).toBe(GHOST_ALIGNMENT_SCALE_MAX)
    expect(result!.originX).toBe(150) // 顔中心(100+50)
    expect(result!.originY).toBe(150)
    expect(result!.translateX).toBe(350) // 画面中央500 - 150
    expect(result!.translateY).toBe(350)
  })

  it('object-fit:coverによる縦横クロップを考慮して画面座標を計算する', () => {
    const box = { width: 800, height: 400 } // 横長の枠
    // frame(400x400、正方形)をcoverで800x400の枠に敷くと横基準(scale=2)になり、
    // 縦は800にはみ出して上下(-200ずつ)が枠外にクロップされる。
    const ghost: GhostFaceDetection = {
      frame: { width: 400, height: 400 },
      face: { x: 100, y: 100, width: 200, height: 200 }, // frame内で中心(200,200)
    }

    const result = computeGhostRingAlignment(box, ghost)
    expect(result).not.toBeNull()
    // 顔中心(200,200)がscale=2で(400,400)、offsetY=(400-800)/2=-200なので画面(400,200)
    expect(result!.originX).toBe(400)
    expect(result!.originY).toBe(200)
    // 顔は既にbox中心(400,200)にあるためtranslateは0
    expect(result!.translateX).toBeCloseTo(0)
    expect(result!.translateY).toBeCloseTo(0)
  })

  it('ghostがnullならnullを返す', () => {
    const box = { width: 1000, height: 1000 }
    expect(computeGhostRingAlignment(box, null)).toBeNull()
  })

  it('boxのサイズが0以下ならnullを返す', () => {
    const ghost: GhostFaceDetection = { frame: { width: 1000, height: 1000 }, face: { x: 300, y: 300, width: 100, height: 100 } }
    expect(computeGhostRingAlignment({ width: 0, height: 0 }, ghost)).toBeNull()
  })

  it('顔ボックスの幅・高さが0以下ならnullを返す', () => {
    const box = { width: 1000, height: 1000 }
    const ghost: GhostFaceDetection = { frame: { width: 1000, height: 1000 }, face: { x: 400, y: 400, width: 0, height: 0 } }
    expect(computeGhostRingAlignment(box, ghost)).toBeNull()
  })

  it('顔が非常に大きい(すでにフレームいっぱい)場合はGHOST_ALIGNMENT_SCALE_MINでクランプされる', () => {
    const box = { width: 1000, height: 1000 }
    // targetHeightOnScreen = 475。faceHeightOnScreen=1200(scale=1)だとrawScale=475/1200≈0.396<0.4
    const ghost: GhostFaceDetection = {
      frame: { width: 1000, height: 1000 },
      face: { x: 100, y: 100, width: 1200, height: 1200 },
    }
    const result = computeGhostRingAlignment(box, ghost)
    expect(result).not.toBeNull()
    expect(result!.scale).toBe(GHOST_ALIGNMENT_SCALE_MIN)
  })
})
