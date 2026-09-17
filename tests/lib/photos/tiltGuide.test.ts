// ================================================================
// tiltGuide.ts — 写真カルテ Phase 2(水平器/ジャイロガイド)の判定ロジック単体テスト
// ================================================================
import { describe, expect, it } from 'vitest'
import {
  computeTiltDeviation,
  evaluateTiltLevel,
  pickTiltMessage,
  TILT_TOLERANCE_DEG,
  type DeviceOrientationSample,
} from '../../../src/lib/photos/tiltGuide'

const BASELINE: DeviceOrientationSample = { beta: 80, gamma: 5 }

describe('computeTiltDeviation', () => {
  it('現在値=基準値なら偏差は0', () => {
    const deviation = computeTiltDeviation(BASELINE, BASELINE)
    expect(deviation.rollDeg).toBe(0)
    expect(deviation.pitchDeg).toBe(0)
  })

  it('gamma/betaの差分をそのまま返す', () => {
    const deviation = computeTiltDeviation({ beta: 85, gamma: 10 }, BASELINE)
    expect(deviation.rollDeg).toBe(5)
    expect(deviation.pitchDeg).toBe(5)
  })

  it('360度境界をまたぐ差分は[-180,180]へ正規化する', () => {
    const deviation = computeTiltDeviation({ beta: 80, gamma: -175 }, { beta: 80, gamma: 175 })
    expect(deviation.rollDeg).toBe(10)
  })

  it('roll(gamma)・pitch(beta)は互いに独立に判定する(片方のデータ欠落がもう片方に影響しない)', () => {
    const deviation = computeTiltDeviation({ beta: null, gamma: 10 }, BASELINE)
    expect(deviation.rollDeg).toBe(5) // gammaは現在値・基準値とも揃っているため計算できる
    expect(deviation.pitchDeg).toBeNull() // betaは現在値が欠落しているためnull
  })
})

describe('evaluateTiltLevel', () => {
  it('偏差が閾値以内ならok', () => {
    expect(evaluateTiltLevel({ rollDeg: 0, pitchDeg: 0 })).toBe('ok')
    expect(evaluateTiltLevel({ rollDeg: TILT_TOLERANCE_DEG, pitchDeg: TILT_TOLERANCE_DEG })).toBe('ok')
  })

  it('roll・pitchいずれかが閾値を超えるとtilted', () => {
    expect(evaluateTiltLevel({ rollDeg: TILT_TOLERANCE_DEG + 1, pitchDeg: 0 })).toBe('tilted')
    expect(evaluateTiltLevel({ rollDeg: 0, pitchDeg: -(TILT_TOLERANCE_DEG + 1) })).toBe('tilted')
  })

  it('データが無い(null)場合はunknown', () => {
    expect(evaluateTiltLevel({ rollDeg: null, pitchDeg: 0 })).toBe('unknown')
    expect(evaluateTiltLevel({ rollDeg: 0, pitchDeg: null })).toBe('unknown')
  })
})

describe('pickTiltMessage', () => {
  it('tiltedの場合のみメッセージを返す', () => {
    expect(pickTiltMessage('tilted')).toBe('iPadを水平に構えてください')
    expect(pickTiltMessage('ok')).toBeNull()
    expect(pickTiltMessage('unknown')).toBeNull()
  })
})
