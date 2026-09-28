// ================================================================
// usePhotoCapture.ts — 写真撮影画質改善 Phase 1 / Phase 3-A
//
// CAMERA_CONSTRAINTSはgetUserMediaに渡す定数そのもの(フック本体は
// @testing-library/react等が無いこのプロジェクトではrenderできないため、
// フックをレンダリングせずに検証できる形でexportしている値を直接確認する)。
// ================================================================
import { describe, expect, it } from 'vitest'
import { CAMERA_CONSTRAINTS } from '../../src/hooks/usePhotoCapture'

describe('CAMERA_CONSTRAINTS（写真撮影画質改善 Phase 3-A）', () => {
  it('width/heightをidealで3072x2304要求する(exactにはしない)', () => {
    const video = CAMERA_CONSTRAINTS.video as MediaTrackConstraints
    expect(video.width).toEqual({ ideal: 3072 })
    expect(video.height).toEqual({ ideal: 2304 })
  })

  it('facingModeもidealで背面カメラを要求する(exactにはしない)', () => {
    const video = CAMERA_CONSTRAINTS.video as MediaTrackConstraints
    expect(video.facingMode).toEqual({ ideal: 'environment' })
  })

  it('width/height/facingModeいずれもexact/min/maxを含まない(端末が対応していなくても起動できるようにするため)', () => {
    const video = CAMERA_CONSTRAINTS.video as Record<string, unknown>
    for (const key of ['width', 'height', 'facingMode']) {
      const constraint = video[key] as Record<string, unknown>
      expect(constraint).not.toHaveProperty('exact')
      expect(constraint).not.toHaveProperty('min')
      expect(constraint).not.toHaveProperty('max')
    }
  })

  it('audioは要求しない', () => {
    expect(CAMERA_CONSTRAINTS.audio).toBe(false)
  })

  // ── 手ブレ・ピンボケ対策(2026-09-28ユーザー承認) ────────────────────────────

  it('frameRateをidealで30要求する(exactにはしない)', () => {
    const video = CAMERA_CONSTRAINTS.video as MediaTrackConstraints
    expect(video.frameRate).toEqual({ ideal: 30 })
  })

  it('focusMode/exposureModeをidealでcontinuous要求する(iPadOS Safariでは無視される想定だが、非対応環境でも例外にはならない)', () => {
    const video = CAMERA_CONSTRAINTS.video as Record<string, unknown>
    expect(video.focusMode).toEqual({ ideal: 'continuous' })
    expect(video.exposureMode).toEqual({ ideal: 'continuous' })
  })

  it('frameRate/focusMode/exposureModeもexact/min/maxを含まない', () => {
    const video = CAMERA_CONSTRAINTS.video as Record<string, unknown>
    for (const key of ['frameRate', 'focusMode', 'exposureMode']) {
      const constraint = video[key] as Record<string, unknown>
      expect(constraint).not.toHaveProperty('exact')
      expect(constraint).not.toHaveProperty('min')
      expect(constraint).not.toHaveProperty('max')
    }
  })
})
