// ================================================================
// faceGuide.ts — 撮影ガイド強化の判定ロジック単体テスト
//
// 対応: PHASE IPAD-PHOTO-CAPTURE-3(2026-09-15)。大きさ・位置・傾きのOK/NG判定。
// ================================================================
import { describe, expect, it } from 'vitest'
import {
  evaluateFaceGuide,
  pickFaceGuideMessage,
  FACE_GUIDE_SIZE_MIN_RATIO,
  FACE_GUIDE_SIZE_MAX_RATIO,
  FACE_GUIDE_POSITION_TOLERANCE_RATIO,
  FACE_GUIDE_TILT_TOLERANCE_DEG,
  type FaceGuideDetection,
} from '../../../src/lib/photos/faceGuide'

const FRAME = { width: 1000, height: 1000 }

function centeredDetection(overrides: Partial<FaceGuideDetection['box']> = {}): FaceGuideDetection {
  const size = (FACE_GUIDE_SIZE_MIN_RATIO + FACE_GUIDE_SIZE_MAX_RATIO) / 2 * FRAME.height
  const box = { x: (FRAME.width - size) / 2, y: (FRAME.height - size) / 2, width: size, height: size, ...overrides }
  return { box }
}

describe('evaluateFaceGuide', () => {
  it('modeがnoneの場合は検出結果に関わらず常にok扱い(額はガイド判定自体を行わない)', () => {
    const state = evaluateFaceGuide(null, 'none', FRAME)
    expect(state.faceDetected).toBe(false)
    expect(state.size).toBe('ok')
  })

  it('検出結果がnullの場合はfaceDetected:falseを返す', () => {
    const state = evaluateFaceGuide(null, 'full', FRAME)
    expect(state.faceDetected).toBe(false)
    expect(state.tilt).toBe('not_checked')
  })

  it('適切な大きさ・中央位置ならすべてokになる', () => {
    const state = evaluateFaceGuide(centeredDetection(), 'full', FRAME)
    expect(state.faceDetected).toBe(true)
    expect(state.size).toBe('ok')
    expect(state.horizontal).toBe('ok')
    expect(state.vertical).toBe('ok')
  })

  it('顔が小さすぎる(遠すぎる)場合はtoo_farになる', () => {
    const tooSmall = FACE_GUIDE_SIZE_MIN_RATIO * FRAME.height * 0.5
    const detection = centeredDetection({ width: tooSmall, height: tooSmall })
    const state = evaluateFaceGuide(detection, 'full', FRAME)
    expect(state.size).toBe('too_far')
  })

  it('顔が大きすぎる(近すぎる)場合はtoo_closeになる', () => {
    const tooBig = FRAME.height // 画面いっぱい
    const detection = centeredDetection({ width: tooBig, height: tooBig })
    const state = evaluateFaceGuide(detection, 'full', FRAME)
    expect(state.size).toBe('too_close')
  })

  it('顔が左寄りの場合はhorizontal:lowになる(画面座標で中心より小さいx)', () => {
    const detection = centeredDetection({ x: 0 })
    const state = evaluateFaceGuide(detection, 'full', FRAME)
    expect(state.horizontal).toBe('low')
  })

  it('顔が右寄りの場合はhorizontal:highになる', () => {
    const size = (FACE_GUIDE_SIZE_MIN_RATIO + FACE_GUIDE_SIZE_MAX_RATIO) / 2 * FRAME.height
    const detection = centeredDetection({ x: FRAME.width - size })
    const state = evaluateFaceGuide(detection, 'full', FRAME)
    expect(state.horizontal).toBe('high')
  })

  it('許容範囲ぎりぎり内側ならokのまま(閾値の境界確認)', () => {
    const size = (FACE_GUIDE_SIZE_MIN_RATIO + FACE_GUIDE_SIZE_MAX_RATIO) / 2 * FRAME.height
    const offsetX = (FACE_GUIDE_POSITION_TOLERANCE_RATIO - 0.01) * FRAME.width
    const detection = centeredDetection({ x: (FRAME.width - size) / 2 + offsetX })
    const state = evaluateFaceGuide(detection, 'full', FRAME)
    expect(state.horizontal).toBe('ok')
  })

  it('mode=full かつ 目のキーポイントが水平の場合はtilt:okになる', () => {
    const detection: FaceGuideDetection = {
      ...centeredDetection(),
      eyes: { rightEye: { x: 0.4, y: 0.4 }, leftEye: { x: 0.6, y: 0.4 } },
    }
    const state = evaluateFaceGuide(detection, 'full', FRAME)
    expect(state.tilt).toBe('ok')
  })

  it('mode=full かつ 目のキーポイントが大きく傾いている場合はtilted_left/rightのいずれかになる', () => {
    const detection: FaceGuideDetection = {
      ...centeredDetection(),
      eyes: { rightEye: { x: 0.4, y: 0.3 }, leftEye: { x: 0.6, y: 0.5 } }, // dy/dx から30度超の傾き
    }
    const state = evaluateFaceGuide(detection, 'full', FRAME)
    expect(['tilted_left', 'tilted_right']).toContain(state.tilt)
  })

  it('mode=position_sizeの場合、目のキーポイントがあっても傾き判定はnot_checkedのまま(今回スコープ外)', () => {
    const detection: FaceGuideDetection = {
      ...centeredDetection(),
      eyes: { rightEye: { x: 0.4, y: 0.3 }, leftEye: { x: 0.6, y: 0.5 } },
    }
    const state = evaluateFaceGuide(detection, 'position_size', FRAME)
    expect(state.tilt).toBe('not_checked')
  })

  it('目のキーポイントが無い場合はtilt:not_checkedになる(モデルが返さなかった場合の防御)', () => {
    const state = evaluateFaceGuide(centeredDetection(), 'full', FRAME)
    expect(state.tilt).toBe('not_checked')
  })

  it('目の傾き角度がちょうど閾値の場合はokのまま(境界値、超えた場合のみtilted)', () => {
    const angleRad = (FACE_GUIDE_TILT_TOLERANCE_DEG * Math.PI) / 180
    const dx = Math.cos(angleRad)
    const dy = Math.sin(angleRad)
    const detection: FaceGuideDetection = {
      ...centeredDetection(),
      eyes: { rightEye: { x: 0.5 - dx / 2, y: 0.5 - dy / 2 }, leftEye: { x: 0.5 + dx / 2, y: 0.5 + dy / 2 } },
    }
    const state = evaluateFaceGuide(detection, 'full', FRAME)
    expect(state.tilt).toBe('ok')
  })
})

describe('pickFaceGuideMessage', () => {
  it('全てokならnullを返す(肯定表示に切り替えるための合図)', () => {
    const state = evaluateFaceGuide(centeredDetection(), 'full', FRAME)
    expect(pickFaceGuideMessage(state)).toBeNull()
  })

  it('未検出が最優先で表示される', () => {
    const state = evaluateFaceGuide(null, 'full', FRAME)
    expect(pickFaceGuideMessage(state)).toBe('顔が検出できません')
  })

  it('大きさの問題は位置の問題より優先して表示される', () => {
    const size = FRAME.height // 大きすぎる
    const detection = centeredDetection({ x: 0, width: size, height: size }) // 位置もずれている
    const state = evaluateFaceGuide(detection, 'full', FRAME)
    expect(pickFaceGuideMessage(state)).toBe('もう少し離れてください')
  })

  it('位置は左右のずれを傾きより優先して表示する', () => {
    const detection: FaceGuideDetection = {
      ...centeredDetection({ x: 0 }),
      eyes: { rightEye: { x: 0.4, y: 0.3 }, leftEye: { x: 0.6, y: 0.5 } },
    }
    const state = evaluateFaceGuide(detection, 'full', FRAME)
    expect(pickFaceGuideMessage(state)).toBe('顔が画面の左寄りです')
  })
})
