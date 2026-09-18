// ================================================================
// ghostAutoScale.ts — ゴースト初期倍率の自動算出 単体テスト
//
// 対応: 写真カルテ Phase 2 追加調整(小宮山様の実機フィードバック「ゴーストが
// 大きすぎる」対応、2026-09-18)。
// ================================================================
import { describe, expect, it } from 'vitest'
import {
  computeGhostAutoScalePercent,
  GHOST_AUTO_SCALE_MIN_PERCENT,
  GHOST_AUTO_SCALE_MAX_PERCENT,
  type GhostFaceSample,
} from '../../../src/lib/photos/ghostAutoScale'

describe('computeGhostAutoScalePercent', () => {
  it('ライブ・ゴースト双方が同じ顔サイズ比率なら100%を返す', () => {
    const live: GhostFaceSample = { faceBoxHeight: 400, frameHeight: 1000 }
    const ghost: GhostFaceSample = { faceBoxHeight: 400, frameHeight: 1000 }
    expect(computeGhostAutoScalePercent(live, ghost)).toBe(100)
  })

  it('ゴーストの顔がライブより小さい比率なら100%超(拡大)を返す', () => {
    const live: GhostFaceSample = { faceBoxHeight: 500, frameHeight: 1000 } // 50%
    const ghost: GhostFaceSample = { faceBoxHeight: 250, frameHeight: 1000 } // 25%
    expect(computeGhostAutoScalePercent(live, ghost)).toBe(200)
  })

  it('ゴーストの顔がライブより大きい比率なら100%未満(縮小)を返す', () => {
    const live: GhostFaceSample = { faceBoxHeight: 250, frameHeight: 1000 } // 25%
    const ghost: GhostFaceSample = { faceBoxHeight: 500, frameHeight: 1000 } // 50%
    expect(computeGhostAutoScalePercent(live, ghost)).toBe(50)
  })

  it('極端な比率差はGHOST_AUTO_SCALE_MIN/MAX_PERCENTでクランプする', () => {
    const live: GhostFaceSample = { faceBoxHeight: 900, frameHeight: 1000 }
    const ghost: GhostFaceSample = { faceBoxHeight: 50, frameHeight: 1000 }
    expect(computeGhostAutoScalePercent(live, ghost)).toBe(GHOST_AUTO_SCALE_MAX_PERCENT)

    const live2: GhostFaceSample = { faceBoxHeight: 50, frameHeight: 1000 }
    const ghost2: GhostFaceSample = { faceBoxHeight: 900, frameHeight: 1000 }
    expect(computeGhostAutoScalePercent(live2, ghost2)).toBe(GHOST_AUTO_SCALE_MIN_PERCENT)
  })

  it('liveがnullならnullを返す', () => {
    const ghost: GhostFaceSample = { faceBoxHeight: 400, frameHeight: 1000 }
    expect(computeGhostAutoScalePercent(null, ghost)).toBeNull()
  })

  it('ghostがnullならnullを返す', () => {
    const live: GhostFaceSample = { faceBoxHeight: 400, frameHeight: 1000 }
    expect(computeGhostAutoScalePercent(live, null)).toBeNull()
  })

  it('frameHeightが0以下ならnullを返す', () => {
    const live: GhostFaceSample = { faceBoxHeight: 400, frameHeight: 0 }
    const ghost: GhostFaceSample = { faceBoxHeight: 400, frameHeight: 1000 }
    expect(computeGhostAutoScalePercent(live, ghost)).toBeNull()
  })

  it('faceBoxHeightが0以下ならnullを返す', () => {
    const live: GhostFaceSample = { faceBoxHeight: 0, frameHeight: 1000 }
    const ghost: GhostFaceSample = { faceBoxHeight: 400, frameHeight: 1000 }
    expect(computeGhostAutoScalePercent(live, ghost)).toBeNull()
  })
})
