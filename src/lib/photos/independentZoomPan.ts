/**
 * independentZoomPan.ts — 並列比較(sideBySide)専用の「左右独立ズーム・パン」の純粋ロジック。
 *
 * React/DOMに非依存(座標は呼び出し側が「操作領域の左上を原点とする相対座標」へ変換して渡す)。
 * src/hooks/useIndependentZoomPan.ts がこのコントローラを1枚ごとに1つずつ生成して使うため、
 * 左右でscale/tx/ty・ポインタ管理・ピンチ・ダブルタップ状態が一切共有されない。
 *
 * 座標系: <img>は操作領域いっぱい(position:absolute; inset:0; objectFit:contain)に置かれ、
 * `transform: translate(tx,ty) scale(s)` を transform-origin: 0 0 で適用する前提。
 * このとき画面上の点 p = t + s * q (q=変換前の領域内座標)。
 *   - 点fを基準にscaleをs→s'にする: t' = f - (f - t) * (s'/s)
 *   - ピンチ: 開始中点の下にあったコンテンツ点q0 = (m0 - t0)/s0 が常に現在の中点mの下に
 *     来るよう t = m - s*q0 とする(ズーム基準＝開始中点、中点移動＝パンが同じ式で表現できる)。
 *
 * 写真は objectFit: contain のため、枠より小さく表示される軸には余白がある。パン範囲は
 * 枠ではなく「contain後の実表示サイズ」を基準にする(containedSize/panBounds)。
 */

export const ZOOM_MIN_SCALE = 1
export const ZOOM_MAX_SCALE = 4
/** ダブルタップで拡大する倍率(等倍→この倍率)。 */
export const DOUBLE_TAP_SCALE = 2.5
/** 2回のタップを「ダブルタップ」とみなす最大間隔(ms)。 */
export const DOUBLE_TAP_MS = 300
/** ダブルタップとみなす2回のタップ位置の最大距離(px)。 */
export const DOUBLE_TAP_MAX_DISTANCE_PX = 40
/** ダブルタップ成立後、この間のタップは無視する(3・4回目の連打を新しいダブルタップにしない)。 */
export const DOUBLE_TAP_LOCK_MS = 350
/** 1回のタップとみなす最大の指の移動量(px)・最大の接触時間(ms)。 */
export const TAP_MAX_MOVE_PX = 10
export const TAP_MAX_DURATION_MS = 400
/** この倍率以下は「等倍」として扱う(パン不可)。 */
export const ZOOMED_EPSILON = 1.01

export interface ZoomPanState {
  scale: number
  tx: number
  ty: number
}

export interface Size {
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export const INITIAL_ZOOM_PAN_STATE: ZoomPanState = { scale: 1, tx: 0, ty: 0 }

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

export function clampScale(scale: number): number {
  return clamp(scale, ZOOM_MIN_SCALE, ZOOM_MAX_SCALE)
}

/**
 * objectFit: contain 後の実表示サイズ。natural が未取得(null/0)なら枠いっぱいとみなす。
 */
export function containedSize(box: Size, natural: Size | null): Size {
  if (!natural || natural.width <= 0 || natural.height <= 0 || box.width <= 0 || box.height <= 0) {
    return { width: box.width, height: box.height }
  }
  const fit = Math.min(box.width / natural.width, box.height / natural.height)
  return { width: natural.width * fit, height: natural.height * fit }
}

export interface PanBounds {
  minTx: number
  maxTx: number
  minTy: number
  maxTy: number
}

function axisBounds(container: number, displayed: number, scale: number): [number, number] {
  const offset = (container - displayed) / 2 // 変換前の余白(片側)
  // 写真の端が枠の端に一致する2つのtranslate値。
  const a = -scale * offset
  const b = container - scale * (offset + displayed)
  // 拡大後の写真が枠より大きい軸: 写真が枠を覆い続ける範囲(枠内に空白を作らない)。
  // 拡大後も枠より小さい軸: 写真全体が枠内に収まる範囲(写真が枠から消えない)。
  // どちらも「端が一致する2値の間」で表現できる。
  // `+ 0` は -0 を 0 へ正規化する。
  return [Math.min(a, b) + 0, Math.max(a, b) + 0]
}

/** scaleに応じたパン可能範囲(contain後の実表示サイズ基準)。 */
export function panBounds(scale: number, box: Size, natural: Size | null): PanBounds {
  const d = containedSize(box, natural)
  const [minTx, maxTx] = axisBounds(box.width, d.width, scale)
  const [minTy, maxTy] = axisBounds(box.height, d.height, scale)
  return { minTx, maxTx, minTy, maxTy }
}

export function clampTranslate(state: ZoomPanState, box: Size, natural: Size | null): ZoomPanState {
  const b = panBounds(state.scale, box, natural)
  return {
    scale: state.scale,
    tx: clamp(state.tx, b.minTx, b.maxTx),
    ty: clamp(state.ty, b.minTy, b.maxTy),
  }
}

/** 点focalを基準にscaleをnextScaleへ変える(focalの下のコンテンツ位置を保つ)。範囲はclamp済み。 */
export function zoomAround(
  state: ZoomPanState,
  focal: Point,
  nextScaleRaw: number,
  box: Size,
  natural: Size | null,
): ZoomPanState {
  const nextScale = clampScale(nextScaleRaw)
  const ratio = nextScale / state.scale
  const next: ZoomPanState = {
    scale: nextScale,
    tx: focal.x - (focal.x - state.tx) * ratio,
    ty: focal.y - (focal.y - state.ty) * ratio,
  }
  return clampTranslate(next, box, natural)
}

/** ダブルタップ: 拡大中なら1倍+tx=ty=0へ、等倍ならタップ位置基準でDOUBLE_TAP_SCALE倍へ。 */
export function applyDoubleTap(
  state: ZoomPanState,
  tapPoint: Point,
  box: Size,
  natural: Size | null,
): ZoomPanState {
  if (state.scale > ZOOMED_EPSILON) return { ...INITIAL_ZOOM_PAN_STATE }
  return zoomAround(state, tapPoint, DOUBLE_TAP_SCALE, box, natural)
}

export interface PinchStart {
  /** ピンチ開始時の2本指の距離。 */
  distance: number
  scale: number
  /** ピンチ開始中点の下にあった、変換前領域内のコンテンツ座標。 */
  anchor: Point
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

export function distanceBetween(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function startPinch(state: ZoomPanState, a: Point, b: Point): PinchStart {
  const m = midpoint(a, b)
  return {
    distance: distanceBetween(a, b),
    scale: state.scale,
    anchor: { x: (m.x - state.tx) / state.scale, y: (m.y - state.ty) / state.scale },
  }
}

/** ピンチ中の新しいstate。ズームは開始中点基準、現在の中点移動はパンとして反映される。 */
export function applyPinch(
  start: PinchStart,
  a: Point,
  b: Point,
  box: Size,
  natural: Size | null,
): ZoomPanState {
  const scale = clampScale(start.scale * (distanceBetween(a, b) / (start.distance || 1)))
  if (scale <= ZOOMED_EPSILON) return { ...INITIAL_ZOOM_PAN_STATE } // 等倍ではパン不可
  const m = midpoint(a, b)
  return clampTranslate(
    { scale, tx: m.x - scale * start.anchor.x, ty: m.y - scale * start.anchor.y },
    box,
    natural,
  )
}

export interface PointerSample {
  id: number
  /** 操作領域の左上を原点とする相対座標。 */
  x: number
  y: number
  /** ミリ秒の単調増加時刻(Date.now()等)。 */
  time: number
}

interface TapCandidate {
  x: number
  y: number
  time: number
  valid: boolean
}

export interface ZoomPanController {
  getState(): ZoomPanState
  setNaturalSize(natural: Size | null): void
  reset(): void
  pointerDown(p: PointerSample, box: Size): void
  pointerMove(p: PointerSample, box: Size): void
  pointerUp(p: PointerSample, box: Size): void
  pointerCancel(id: number): void
}

/**
 * 1枚の写真(1つの操作領域)専用のジェスチャーコントローラ。インスタンスごとに
 * scale/tx/ty・pointers・pinch・ダブルタップ状態が完全に独立している。
 */
export function createZoomPanController(onChange?: (state: ZoomPanState) => void): ZoomPanController {
  let state: ZoomPanState = { ...INITIAL_ZOOM_PAN_STATE }
  let natural: Size | null = null
  const pointers = new Map<number, Point>()
  const tapCandidates = new Map<number, TapCandidate>()
  let pinch: PinchStart | null = null
  let pan: { x: number; y: number; tx: number; ty: number } | null = null
  let lastTap: { x: number; y: number; time: number } | null = null
  let tapLockedUntil = 0

  const commit = (next: ZoomPanState) => {
    if (next.scale === state.scale && next.tx === state.tx && next.ty === state.ty) return
    state = next
    onChange?.(state)
  }

  const beginPanFrom = (p: Point) => {
    pan = state.scale > ZOOMED_EPSILON ? { x: p.x, y: p.y, tx: state.tx, ty: state.ty } : null
  }

  const handleTap = (p: PointerSample, box: Size) => {
    if (p.time < tapLockedUntil) {
      lastTap = null
      return
    }
    if (
      lastTap &&
      p.time - lastTap.time <= DOUBLE_TAP_MS &&
      Math.hypot(p.x - lastTap.x, p.y - lastTap.y) <= DOUBLE_TAP_MAX_DISTANCE_PX
    ) {
      lastTap = null
      tapLockedUntil = p.time + DOUBLE_TAP_LOCK_MS
      pan = null
      commit(applyDoubleTap(state, { x: p.x, y: p.y }, box, natural))
      return
    }
    lastTap = { x: p.x, y: p.y, time: p.time }
  }

  return {
    getState: () => state,
    setNaturalSize(n) {
      natural = n
    },
    reset() {
      pointers.clear()
      tapCandidates.clear()
      pinch = null
      pan = null
      lastTap = null
      tapLockedUntil = 0
      commit({ ...INITIAL_ZOOM_PAN_STATE })
    },
    pointerDown(p) {
      pointers.set(p.id, { x: p.x, y: p.y })
      if (pointers.size >= 2) {
        // 複数指が触れたジェスチャーはタップ扱いにしない(ピンチ中の指が最後に離れてもダブルタップにならない)。
        tapCandidates.forEach(c => { c.valid = false })
        lastTap = null
        pan = null
        const pts = Array.from(pointers.values())
        if (pts.length === 2) pinch = startPinch(state, pts[0], pts[1])
        return
      }
      tapCandidates.set(p.id, { x: p.x, y: p.y, time: p.time, valid: true })
      beginPanFrom(p)
    },
    pointerMove(p, box) {
      if (!pointers.has(p.id)) return
      pointers.set(p.id, { x: p.x, y: p.y })
      const cand = tapCandidates.get(p.id)
      if (cand && cand.valid && Math.hypot(p.x - cand.x, p.y - cand.y) > TAP_MAX_MOVE_PX) cand.valid = false

      if (pointers.size === 2 && pinch) {
        const pts = Array.from(pointers.values())
        commit(applyPinch(pinch, pts[0], pts[1], box, natural))
        return
      }
      if (pointers.size === 1 && pan) {
        commit(
          clampTranslate(
            { scale: state.scale, tx: pan.tx + (p.x - pan.x), ty: pan.ty + (p.y - pan.y) },
            box,
            natural,
          ),
        )
      }
    },
    pointerUp(p, box) {
      if (!pointers.has(p.id)) return
      const cand = tapCandidates.get(p.id)
      pointers.delete(p.id)
      tapCandidates.delete(p.id)
      if (pointers.size < 2) pinch = null
      if (pointers.size === 0) {
        pan = null
        if (cand && cand.valid && p.time - cand.time <= TAP_MAX_DURATION_MS) handleTap(p, box)
      } else if (pointers.size === 1) {
        // ピンチ後に残った1本の指でそのままパンを継続する(拡大中のみ)。
        beginPanFrom(Array.from(pointers.values())[0])
      }
    },
    pointerCancel(id) {
      pointers.delete(id)
      tapCandidates.delete(id)
      if (pointers.size < 2) pinch = null
      if (pointers.size === 0) pan = null
      else if (pointers.size === 1) beginPanFrom(Array.from(pointers.values())[0])
    },
  }
}
