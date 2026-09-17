/**
 * tiltGuide.ts — 写真カルテ Phase 2(水平器/ジャイロガイド)の判定ロジック。
 *
 * faceGuide.tsと同じ方針(DOM・センサーAPIの型には一切依存しない純粋関数群)により、
 * ユニットテストで確定的に検証できるようにする。
 *
 * 設計上の割り切り(2026-09-17時点、実機での校正が前提):
 *   DeviceOrientationEventのbeta/gammaは機種・画面の向き(縦持ち/横持ち)によって
 *   絶対値の意味が変わり、実機なしでは正しい校正ができない。そのため絶対値ではなく
 *   「ジャイロガイドを開始した瞬間(基準姿勢)からの相対的なズレ」を使う設計にする
 *   (スタッフが構え始めた姿勢を基準とし、そこからの傾き変化のみを検知する)。
 *   閾値(TILT_TOLERANCE_DEG)はPhase1のFACE_GUIDE_*と同じ位置づけの暫定値であり、
 *   実機での試行錯誤を経て調整すること。
 */

export type TiltLevelStatus = 'ok' | 'tilted' | 'unknown'

export interface DeviceOrientationSample {
  beta: number | null
  gamma: number | null
}

export interface TiltDeviation {
  /** 左右方向の傾き(度)。基準姿勢からのgamma変化量。データ不足時はnull。 */
  rollDeg: number | null
  /** 前後方向の傾き(度)。基準姿勢からのbeta変化量。データ不足時はnull。 */
  pitchDeg: number | null
}

/** 基準姿勢からの傾きがこの値を超えると「傾いている」と判定する。Phase1と同方針の暫定値。 */
export const TILT_TOLERANCE_DEG = 4

/** 角度差を[-180, 180]の範囲へ正規化する(360度境界をまたぐ差分を避けるため)。 */
function normalizeAngleDiff(diff: number): number {
  let d = diff % 360
  if (d > 180) d -= 360
  if (d < -180) d += 360
  return d
}

/**
 * 現在の姿勢と基準姿勢(ガイド開始時に1回だけ記録)の差分を計算する。
 * どちらかのサンプルが欠けている(センサー未対応・値未取得)場合はnullを返す。
 */
export function computeTiltDeviation(
  current: DeviceOrientationSample,
  baseline: DeviceOrientationSample
): TiltDeviation {
  const rollDeg =
    current.gamma !== null && baseline.gamma !== null
      ? normalizeAngleDiff(current.gamma - baseline.gamma)
      : null
  const pitchDeg =
    current.beta !== null && baseline.beta !== null
      ? normalizeAngleDiff(current.beta - baseline.beta)
      : null
  return { rollDeg, pitchDeg }
}

/**
 * 傾き量から水平/垂直がOKかを判定する。基準未確立(いずれかがnull)の場合は
 * 'unknown'を返し、UI側は「まだ判定できない」扱い(ガイドを妨げない)にする。
 */
export function evaluateTiltLevel(deviation: TiltDeviation): TiltLevelStatus {
  if (deviation.rollDeg === null || deviation.pitchDeg === null) return 'unknown'
  if (Math.abs(deviation.rollDeg) > TILT_TOLERANCE_DEG || Math.abs(deviation.pitchDeg) > TILT_TOLERANCE_DEG) {
    return 'tilted'
  }
  return 'ok'
}

/** 傾きガイドのフィードバック文言。'ok'/'unknown'はnull(呼び出し側で他のメッセージにフォールバック)。 */
export function pickTiltMessage(level: TiltLevelStatus): string | null {
  if (level === 'tilted') return 'iPadを水平に構えてください'
  return null
}
