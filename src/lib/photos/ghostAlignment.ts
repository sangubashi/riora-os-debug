/**
 * ghostAlignment.ts — ゴーストの自動位置・サイズ合わせ(写真カルテ Phase 2 追加調整・
 * 実機フィードバック「自動倍率だけでは調整精度・使い勝手が不十分」対応、2026-09-18)。
 *
 * 前身のghostAutoScale.ts(写真切替時に一度だけ倍率を計算する方式)は、計算した瞬間の
 * カメラ位置からその後動くとズレてしまい、実機での使い勝手が十分ではないと判明した。
 * この関数は、ライブ映像の顔検出結果(usePhotoCaptureのdetectionループから継続的に
 * 渡される想定)を入力として、呼ばれるたびに「今の顔の位置・大きさ」にゴーストを
 * 合わせるための変換(CSS transform用のtranslate/scaleと、その基準点)を算出する
 * 純粋関数にした。呼び出し側(IpadPhotoCaptureModal.tsx)がライブ映像の検出が更新される
 * 都度(既存の250ms間隔)この関数を呼び直すことで、位置・サイズの自動追従を実現する。
 *
 * 考え方: ライブ映像・ゴースト静止画はどちらもobject-fit:coverで同一の枠に表示される。
 * 両者のネイティブ解像度・枠(box)のサイズから「顔中心が画面上のどこに、どれだけの
 * 大きさで表示されているか」をそれぞれ計算し、ゴースト側の顔がライブ側の顔と同じ画面
 * 位置・同じ大きさになるようなtransformを求める。
 *
 * transform-originをゴースト自身の(変換前の)顔中心の画面座標に置くことで、
 * `transform: translate(dx, dy) scale(s)` の1組だけで「そこを基準に拡大縮小しつつ、
 * 目標位置まで平行移動する」変換になる(scaleの基準点自体を動かす必要がない)。
 */

export interface MediaFrame {
  /** ネイティブ解像度(video.videoWidth/videoHeight、img.naturalWidth/naturalHeightと同じ単位)。 */
  width: number
  height: number
}

/** 検出された顔のバウンディングボックス(フレームのネイティブ座標系)。 */
export interface FaceBox {
  x: number
  y: number
  width: number
  height: number
}

export interface GhostFaceDetection {
  frame: MediaFrame
  face: FaceBox
}

export interface ContainerBox {
  width: number
  height: number
}

export interface GhostAlignmentResult {
  /** ゴースト<img>に掛けるべき追加倍率。 */
  scale: number
  /** transform-origin(px、box左上基準)。ゴースト自身の変換前の顔中心の画面座標。 */
  originX: number
  originY: number
  /** scaleの後に適用する平行移動量(px)。 */
  translateX: number
  translateY: number
}

/** 誤検出等による極端な値を避けるためのクランプ範囲。Phase1の他閾値と同じ暫定値。 */
export const GHOST_ALIGNMENT_SCALE_MIN = 0.4
export const GHOST_ALIGNMENT_SCALE_MAX = 2.5

function coverScale(frame: MediaFrame, box: ContainerBox): number {
  if (frame.width <= 0 || frame.height <= 0 || box.width <= 0 || box.height <= 0) return 0
  return Math.max(box.width / frame.width, box.height / frame.height)
}

/** 顔中心の画面上座標(box左上基準px)と、顔の高さの画面上サイズ(px)。 */
function faceOnScreen(
  detection: GhostFaceDetection,
  box: ContainerBox
): { x: number; y: number; height: number } | null {
  const scale = coverScale(detection.frame, box)
  if (scale <= 0) return null

  const displayedWidth = detection.frame.width * scale
  const displayedHeight = detection.frame.height * scale
  const offsetX = (box.width - displayedWidth) / 2
  const offsetY = (box.height - displayedHeight) / 2

  const faceCenterX = detection.face.x + detection.face.width / 2
  const faceCenterY = detection.face.y + detection.face.height / 2

  return {
    x: offsetX + faceCenterX * scale,
    y: offsetY + faceCenterY * scale,
    height: detection.face.height * scale,
  }
}

/**
 * live(現在のカメラ映像)の顔検出結果に、ghost(ゴースト静止画に対して一度だけ実行した
 * 顔検出結果)を合わせるための変換を算出する。どちらかで顔が検出できない場合、または
 * boxのサイズが未確定(初回レンダリング直後等)の場合はnullを返す
 * (呼び出し側は「等倍・中央表示+手動スライダー」等の従来のフォールバックに戻す)。
 */
export function computeGhostAlignment(
  box: ContainerBox,
  live: GhostFaceDetection | null,
  ghost: GhostFaceDetection | null
): GhostAlignmentResult | null {
  if (!live || !ghost) return null
  if (live.face.width <= 0 || live.face.height <= 0) return null
  if (ghost.face.width <= 0 || ghost.face.height <= 0) return null

  const livePoint = faceOnScreen(live, box)
  const ghostPoint = faceOnScreen(ghost, box)
  if (!livePoint || !ghostPoint || ghostPoint.height <= 0) return null

  const rawScale = livePoint.height / ghostPoint.height
  if (!Number.isFinite(rawScale)) return null
  const scale = Math.max(GHOST_ALIGNMENT_SCALE_MIN, Math.min(GHOST_ALIGNMENT_SCALE_MAX, rawScale))

  return {
    scale,
    originX: ghostPoint.x,
    originY: ghostPoint.y,
    translateX: livePoint.x - ghostPoint.x,
    translateY: livePoint.y - ghostPoint.y,
  }
}
