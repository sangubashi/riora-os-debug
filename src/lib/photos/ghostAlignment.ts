/**
 * ghostAlignment.ts — ゴーストの初期位置・サイズ合わせ(実機フィードバックを受けての
 * 再設計、2026-09-18)。
 *
 * 経緯: 当初は「ライブ映像の顔検出結果にゴーストを継続追従させる」方式(位置・サイズを
 * 250ms間隔で常に再計算)を実装したが、実機で検出結果のフレームごとのブレがそのまま
 * ゴーストの微振動として見えてしまい(「ゴーストが下でちょこちょこ動いてるだけ」)、
 * 使い物にならないと判明した。
 *
 * 方針転換: 既存の顔検出ガイド(丸い破線の輪、IpadPhotoCaptureModal.tsx内でCSSの
 * 固定パーセンテージ left:28%/right:28%/top:14%/bottom:18% により描画)は、検出結果に
 * 応じて動かない固定形状であることを確認した(枠の色だけがガイド状態に応じて変わる)。
 * この輪は「顔をこの枠に収めてください」という不変のターゲットであり、今回撮る写真
 * (ライブ映像)は既存のuseFaceGuide.ts/faceGuide.tsによる大きさ・位置のフィードバック
 * で既にこの枠に収まるよう案内されている。
 *
 * したがって、ゴースト(前回写真)の顔もこの同じ固定ターゲットに一度だけ合わせておけば、
 * ライブ側・ゴースト側の両方が同じ固定ターゲットに揃うことで、結果的に両者が一致する
 * (ライブ検出への継続追従は不要)。ターゲットの数値は、輪の見た目のピクセル範囲
 * (装飾用で、顔検出のタイトな矩形より余白を含む)ではなく、faceGuide.tsが「ちょうど
 * 良い大きさ・位置」と判定する基準(FACE_GUIDE_SIZE_MIN_RATIO〜MAX_RATIOの中央値、
 * 画面中央0.5,0.5)を使う。ライブ側もこの同じ基準で判定されるため、両者の測定方法
 * (MediaPipeの検出ボックス)を揃えることで整合性を保てる。
 *
 * ゴースト静止画は動かないため、この計算は写真が切り替わった時(と表示枠のリサイズ時)
 * にだけ行えばよく、ライブ映像の検出ループに一切依存しない(ジッターの原因を構造的に
 * 排除する)。
 *
 * 自然な楕円フェード(実機フィードバック「ゴースト画像が中央で四角く切り取られ、
 * 背景との境界が目立つ」対応、2026-09-18): 従来はゴースト<img>をそのまま(矩形・
 * ハードエッジ)重ねていたため、スケールダウンした際に画像の四角い輪郭がくっきり
 * 見えてしまっていた。「顔領域だけを自然に重ねる」か「画像全体を自然な縁で重ねる」かを
 * 比較し、前者を採用した: 既存の丸い顔検出ガイドと同じ楕円の見た目で揃えられること、
 * 前回写真の髪型・服・背景まで写り込んで比較の邪魔になることを避けられることから、
 * このアプリの用途(顔の位置合わせ)に適している。maskRadiusX/Yはこの判断に基づく
 * 楕円マスクの半径(呼び出し側がCSS mask-imageのradial-gradientに使う)。
 */
import { FACE_GUIDE_SIZE_MIN_RATIO, FACE_GUIDE_SIZE_MAX_RATIO } from './faceGuide'

export interface MediaFrame {
  /** ネイティブ解像度(img.naturalWidth/naturalHeightと同じ単位)。 */
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
  /**
   * 顔だけを自然な楕円でフェード表示するためのマスク半径(px、transform適用前の
   * box座標系。originX/originYを中心とする楕円で、outer transformのscaleと一緒に
   * 拡大縮小されるため、最終的な画面上のサイズは常に顔の大きさに比例する)。
   */
  maskRadiusX: number
  maskRadiusY: number
}

/** 誤検出等による極端な値を避けるためのクランプ範囲。Phase1の他閾値と同じ暫定値。 */
export const GHOST_ALIGNMENT_SCALE_MIN = 0.4
export const GHOST_ALIGNMENT_SCALE_MAX = 2.5

/**
 * マスク楕円の半径を、検出された顔ボックス(タイトにeyes/nose/mouth周辺を囲むだけで
 * 額・顎・輪郭までは含まないことが多い)の何倍にするか。額から顎までを自然に含める
 * ための余白。実機での見え方を見て調整するPhase1暫定値(FACE_GUIDE_SIZE_MIN_RATIO等と
 * 同じ位置づけ)。
 */
export const GHOST_MASK_FACE_MARGIN = 1.7

/**
 * ゴーストの顔が目指す「顔の高さ/フレーム高さ」比率。既存の顔検出ガイド
 * (faceGuide.tsのFACE_GUIDE_SIZE_MIN_RATIO〜MAX_RATIO、ライブ映像が「ちょうど良い
 * 大きさ」と判定される範囲)の中央値を使う。ライブ側もこの範囲に収まるよう案内される
 * ため、ゴーストをこの値に合わせておけば両者が一致する。
 */
export const GHOST_ALIGNMENT_TARGET_HEIGHT_RATIO = (FACE_GUIDE_SIZE_MIN_RATIO + FACE_GUIDE_SIZE_MAX_RATIO) / 2

/**
 * ゴーストの顔が目指す中心位置(box全体に対する比率)。faceGuide.tsのevaluatePosition
 * が「ちょうど良い位置」の基準として使う画面中央(0.5, 0.5)と揃えている。
 */
export const GHOST_ALIGNMENT_TARGET_CENTER_X_RATIO = 0.5
export const GHOST_ALIGNMENT_TARGET_CENTER_Y_RATIO = 0.5

function coverScale(frame: MediaFrame, box: ContainerBox): number {
  if (frame.width <= 0 || frame.height <= 0 || box.width <= 0 || box.height <= 0) return 0
  return Math.max(box.width / frame.width, box.height / frame.height)
}

/**
 * ゴースト静止画の顔検出結果を、固定ターゲット(顔の高さ比率・中心位置比率)に合わせる
 * ための変換(CSS transform用のtranslate/scaleと、その基準点)を算出する。ゴーストは
 * 動かないので一度計算すれば良く、ライブ映像の検出結果には一切依存しない。顔が検出
 * できない場合、またはboxのサイズが未確定(初回レンダリング直後等)の場合はnullを返す
 * (呼び出し側は「等倍・中央表示+手動スライダー」にフォールバックする)。
 */
export function computeGhostRingAlignment(
  box: ContainerBox,
  ghost: GhostFaceDetection | null
): GhostAlignmentResult | null {
  if (!ghost) return null
  if (ghost.face.width <= 0 || ghost.face.height <= 0) return null

  const scale = coverScale(ghost.frame, box)
  if (scale <= 0) return null

  const displayedWidth = ghost.frame.width * scale
  const displayedHeight = ghost.frame.height * scale
  const offsetX = (box.width - displayedWidth) / 2
  const offsetY = (box.height - displayedHeight) / 2

  const faceCenterX = ghost.face.x + ghost.face.width / 2
  const faceCenterY = ghost.face.y + ghost.face.height / 2
  const originX = offsetX + faceCenterX * scale
  const originY = offsetY + faceCenterY * scale

  const faceHeightOnScreen = ghost.face.height * scale
  if (faceHeightOnScreen <= 0) return null

  const targetHeightOnScreen = GHOST_ALIGNMENT_TARGET_HEIGHT_RATIO * box.height
  const targetX = GHOST_ALIGNMENT_TARGET_CENTER_X_RATIO * box.width
  const targetY = GHOST_ALIGNMENT_TARGET_CENTER_Y_RATIO * box.height

  const rawScale = targetHeightOnScreen / faceHeightOnScreen
  if (!Number.isFinite(rawScale)) return null
  const clampedScale = Math.max(GHOST_ALIGNMENT_SCALE_MIN, Math.min(GHOST_ALIGNMENT_SCALE_MAX, rawScale))

  return {
    scale: clampedScale,
    originX,
    originY,
    translateX: targetX - originX,
    translateY: targetY - originY,
    maskRadiusX: (ghost.face.width * scale * GHOST_MASK_FACE_MARGIN) / 2,
    maskRadiusY: (faceHeightOnScreen * GHOST_MASK_FACE_MARGIN) / 2,
  }
}
