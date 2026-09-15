/**
 * faceGuide.ts — 撮影ガイド強化(PHASE IPAD-PHOTO-CAPTURE-3・2026-09-15)の判定ロジック。
 *
 * MediaPipe(@mediapipe/tasks-vision)の検出結果を「大きさ/位置/傾き」のOK/NG判定へ変換する
 * 純粋関数群。usePhotoCapture.ts以下と同じ「ロジックとI/Oの分離」方針(MediaPipeの型・
 * カメラ・DOMには一切依存しない)により、ユニットテストで確定的に検証できるようにする。
 *
 * 対応する3モード(久保田さん確認済みの設計):
 *   - 'full'(正面): 大きさ・位置・傾きの3種フィードバック
 *   - 'position_size'(右斜め・左斜め): 大きさ・位置のみ(傾きは基準未確定のため今回見送り)
 *   - 'none'(額): 顔検出自体を行わない(額クローズアップは目・鼻・口が写らずモデルが
 *     顔として認識できない可能性が高いため技術的に困難と判断)。静的な枠ガイドのみ表示する。
 *
 * 各閾値は実機での試行錯誤を前提としたPhase1暫定値であり、マジックナンバーではなく
 * 定数として切り出す(CAPTURE_AUTO_CONFIRM_MSと同じ方針)。実機チューニングで調整する。
 */

export type FaceGuideMode = 'full' | 'position_size' | 'none'

/** 検出された顔1件分。videoの実ピクセル座標系(bbox)+0-1正規化座標(keypoints)。 */
export interface FaceGuideDetection {
  /** 検出枠。座標・サイズは映像フレームの実ピクセル値(videoWidth/videoHeightと同じ単位)。 */
  box: { x: number; y: number; width: number; height: number }
  /**
   * 6キーポイントのうち右目・左目(0-1正規化座標)。BlazeFaceの出力順は
   * [右目,左目,鼻先,口,右耳,左耳]で固定(MediaPipe公式ドキュメント)。
   * 「右目」「左目」は被写体本人の解剖学的左右であり、映像上の左右とは限らない
   * (ミラーリングの有無に依存)。傾きの符号(tilted_left/right)が実際の映像と
   * 逆になっていないかは実機で必ず確認すること。
   */
  eyes?: { rightEye: { x: number; y: number }; leftEye: { x: number; y: number } }
}

export type FaceSizeStatus = 'ok' | 'too_close' | 'too_far'
export type FaceAxisStatus = 'ok' | 'low' | 'high'
export type FaceTiltStatus = 'ok' | 'tilted_left' | 'tilted_right' | 'not_checked'

export interface FaceGuideState {
  faceDetected: boolean
  size: FaceSizeStatus
  /** 'low'=画面左寄り、'high'=画面右寄り(video pixel座標のx、ミラーリング無し前提)。 */
  horizontal: FaceAxisStatus
  /** 'low'=画面上寄り、'high'=画面下寄り。 */
  vertical: FaceAxisStatus
  tilt: FaceTiltStatus
}

/** 顔が検出できなかった場合の既定状態。 */
export const FACE_GUIDE_NOT_DETECTED: FaceGuideState = {
  faceDetected: false,
  size: 'ok',
  horizontal: 'ok',
  vertical: 'ok',
  tilt: 'not_checked',
}

/**
 * 顔のバウンディングボックスの高さが映像フレーム高さに占める割合の許容範囲。
 * Phase1暫定値: 顔が画面の35%〜60%程度の高さを占めるのが概ね適切という仮定に基づく。
 * 実機での見え方を見て調整すること。
 */
export const FACE_GUIDE_SIZE_MIN_RATIO = 0.35
export const FACE_GUIDE_SIZE_MAX_RATIO = 0.6

/**
 * 顔の中心が映像フレーム中心からどれだけずれると「ずれている」と判定するかの許容範囲
 * (フレーム幅/高さに対する比率)。Phase1暫定値。
 */
export const FACE_GUIDE_POSITION_TOLERANCE_RATIO = 0.12

/** 目を結んだ線の傾き(度)がこの値を超えると「傾いている」と判定する。Phase1暫定値。 */
export const FACE_GUIDE_TILT_TOLERANCE_DEG = 8

function evaluateSize(box: FaceGuideDetection['box'], frameHeight: number): FaceSizeStatus {
  if (frameHeight <= 0) return 'ok'
  const ratio = box.height / frameHeight
  if (ratio < FACE_GUIDE_SIZE_MIN_RATIO) return 'too_far'
  if (ratio > FACE_GUIDE_SIZE_MAX_RATIO) return 'too_close'
  return 'ok'
}

function evaluatePosition(
  box: FaceGuideDetection['box'],
  frameWidth: number,
  frameHeight: number
): { horizontal: FaceAxisStatus; vertical: FaceAxisStatus } {
  if (frameWidth <= 0 || frameHeight <= 0) return { horizontal: 'ok', vertical: 'ok' }

  const centerX = (box.x + box.width / 2) / frameWidth
  const centerY = (box.y + box.height / 2) / frameHeight

  let horizontal: FaceAxisStatus = 'ok'
  if (centerX < 0.5 - FACE_GUIDE_POSITION_TOLERANCE_RATIO) horizontal = 'low'
  else if (centerX > 0.5 + FACE_GUIDE_POSITION_TOLERANCE_RATIO) horizontal = 'high'

  let vertical: FaceAxisStatus = 'ok'
  if (centerY < 0.5 - FACE_GUIDE_POSITION_TOLERANCE_RATIO) vertical = 'low'
  else if (centerY > 0.5 + FACE_GUIDE_POSITION_TOLERANCE_RATIO) vertical = 'high'

  return { horizontal, vertical }
}

function evaluateTilt(eyes: FaceGuideDetection['eyes']): FaceTiltStatus {
  if (!eyes) return 'not_checked'
  const dx = eyes.leftEye.x - eyes.rightEye.x
  const dy = eyes.leftEye.y - eyes.rightEye.y
  if (dx === 0 && dy === 0) return 'not_checked'

  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI
  if (angleDeg > FACE_GUIDE_TILT_TOLERANCE_DEG) return 'tilted_right'
  if (angleDeg < -FACE_GUIDE_TILT_TOLERANCE_DEG) return 'tilted_left'
  return 'ok'
}

/**
 * 検出結果(またはnull=顔が見つからなかった)を、モードに応じたガイド判定へ変換する。
 * mode='none'の場合は呼び出し側で判定自体を行わない想定(このモードで呼ばれた場合も
 * 一応「常にok」を返すが、UI側はこの結果を使わずに静的ガイドを表示する)。
 */
export function evaluateFaceGuide(
  detection: FaceGuideDetection | null,
  mode: FaceGuideMode,
  frame: { width: number; height: number }
): FaceGuideState {
  if (mode === 'none') return FACE_GUIDE_NOT_DETECTED
  if (!detection) return FACE_GUIDE_NOT_DETECTED

  const size = evaluateSize(detection.box, frame.height)
  const { horizontal, vertical } = evaluatePosition(detection.box, frame.width, frame.height)
  const tilt = mode === 'full' ? evaluateTilt(detection.eyes) : 'not_checked'

  return { faceDetected: true, size, horizontal, vertical, tilt }
}

/**
 * 画面に出す1件のフィードバック文言を優先順位付きで選ぶ(複数の問題が同時にあっても
 * 一度に1つだけ表示し、スタッフを迷わせない)。全てOKならnullを返す(UI側は
 * 「良い構図です」等の肯定表示に切り替える)。
 * 優先順位: 未検出 > 大きさ > 位置(左右→上下) > 傾き。
 */
export function pickFaceGuideMessage(state: FaceGuideState): string | null {
  if (!state.faceDetected) return '顔が検出できません'
  if (state.size === 'too_close') return 'もう少し離れてください'
  if (state.size === 'too_far') return 'もう少し近づいてください'
  // 位置は「どちらに動かすべきか」ではなく「今どちらに寄っているか」を伝える表現にする。
  // カメラを動かすのか被写体が動くのかで正しい指示方向が変わり、誤った方向を案内する
  // リスクがあるため(実機確認までは方向の正誤を検証できない、2026-09-15時点の判断)。
  if (state.horizontal === 'low') return '顔が画面の左寄りです'
  if (state.horizontal === 'high') return '顔が画面の右寄りです'
  if (state.vertical === 'low') return '顔が画面の上寄りです'
  if (state.vertical === 'high') return '顔が画面の下寄りです'
  if (state.tilt === 'tilted_left' || state.tilt === 'tilted_right') return '顔が傾いています'
  return null
}
