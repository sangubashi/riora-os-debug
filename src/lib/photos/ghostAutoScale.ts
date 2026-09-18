/**
 * ghostAutoScale.ts — ゴースト初期倍率の自動算出(写真カルテ Phase 2 追加調整)。
 *
 * 背景: 小宮山様での実機フィードバック「ゴーストの写真が大きすぎる」(2026-09-18)対応。
 * 従来はゴースト(前回写真)とライブ映像を同一の枠にobject-fit:coverで重ねるだけで、
 * 拡大縮小の補正が一切無かった(位置合わせは「カメラを動かす」運用に委ねる設計だった)。
 *
 * この関数は、ライブ映像の顔検出結果(既存のuseFaceGuide)と、ゴースト静止画に対して
 * 一度だけ実行した顔検出結果(useGhostImageFaceDetection、本対応で新規追加)を比較し、
 * 両者の「顔の高さがフレーム高さに占める割合」(faceGuide.tsのevaluateSizeと同じ指標)
 * を揃えるための初期倍率(%)を算出する純粋関数。あくまで初期値の"当たり"を付けるだけで、
 * 最終調整は手動のサイズスライダーに委ねる(移動・回転の位置合わせは引き続き対象外)。
 *
 * 前提と割り切り(Phase1の他の暫定値と同じ考え方): live/ghostどちらもobject-fit:coverで
 * 同一の枠に表示されるため、「顔の高さ/フレームの高さ」の比を揃えれば枠内での見た目の
 * 顔サイズもほぼ揃う(両メディアの縦横比が大きく異ならない前提。縦横比差が大きい場合は
 * 誤差が出得るが、その分は手動スライダーで補正する)。
 */

export interface GhostFaceSample {
  /** 検出された顔ボックスの高さ(px、そのフレームのネイティブ座標系)。 */
  faceBoxHeight: number
  /** フレーム(video/画像)自体の高さ(px、ネイティブ解像度)。 */
  frameHeight: number
}

/** 誤検出等による極端な倍率を避けるためのクランプ範囲。Phase1の他閾値と同じ暫定値。 */
export const GHOST_AUTO_SCALE_MIN_PERCENT = 50
export const GHOST_AUTO_SCALE_MAX_PERCENT = 200

/**
 * live(現在のカメラ映像)とghost(ゴースト静止画)それぞれの顔サンプルから、
 * ゴーストに掛けるべき初期倍率(%、100=等倍)を算出する。
 * いずれかで顔が検出できていない場合はnullを返し、呼び出し側は既定倍率(100%)に
 * フォールバックする。
 */
export function computeGhostAutoScalePercent(
  live: GhostFaceSample | null,
  ghost: GhostFaceSample | null
): number | null {
  if (!live || !ghost) return null
  if (live.frameHeight <= 0 || ghost.frameHeight <= 0) return null
  if (live.faceBoxHeight <= 0 || ghost.faceBoxHeight <= 0) return null

  const liveRatio = live.faceBoxHeight / live.frameHeight
  const ghostRatio = ghost.faceBoxHeight / ghost.frameHeight
  if (ghostRatio <= 0 || !Number.isFinite(ghostRatio)) return null

  const percent = Math.round((liveRatio / ghostRatio) * 100)
  if (!Number.isFinite(percent)) return null

  return Math.max(GHOST_AUTO_SCALE_MIN_PERCENT, Math.min(GHOST_AUTO_SCALE_MAX_PERCENT, percent))
}
