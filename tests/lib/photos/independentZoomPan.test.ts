import { describe, it, expect } from 'vitest'
import {
  ZOOM_MAX_SCALE,
  DOUBLE_TAP_SCALE,
  clampScale,
  containedSize,
  panBounds,
  zoomAround,
  applyDoubleTap,
  startPinch,
  applyPinch,
  createZoomPanController,
  type ZoomPanState,
} from '@/lib/photos/independentZoomPan'

const BOX = { width: 400, height: 600 }
const ID: ZoomPanState = { scale: 1, tx: 0, ty: 0 }
// 画面上の点p = t + s*q
const contentAt = (s: ZoomPanState, p: { x: number; y: number }) => ({ x: (p.x - s.tx) / s.scale, y: (p.y - s.ty) / s.scale })

describe('scale clamp', () => {
  it('1倍未満にならず4倍を超えない', () => {
    expect(clampScale(0.3)).toBe(1)
    expect(clampScale(9)).toBe(ZOOM_MAX_SCALE)
    expect(clampScale(2)).toBe(2)
  })
})

describe('containedSize / panBounds', () => {
  it('縦長写真を枠(横長)にcontainすると左右に余白ができる', () => {
    const d = containedSize({ width: 600, height: 400 }, { width: 300, height: 600 })
    expect(d.height).toBeCloseTo(400)
    expect(d.width).toBeCloseTo(200)
  })

  it('枠いっぱいの軸は等倍でパン範囲0、拡大するほど広がる', () => {
    const nat = { width: 400, height: 600 }
    expect(panBounds(1, BOX, nat)).toEqual({ minTx: 0, maxTx: 0, minTy: 0, maxTy: 0 })
    const b = panBounds(2.5, BOX, nat)
    expect(b.minTx).toBeCloseTo(-600)
    expect(b.maxTx).toBeCloseTo(0)
    expect(b.minTy).toBeCloseTo(-900)
    expect(b.maxTy).toBeCloseTo(0)
  })

  it('contain後の実表示サイズ基準: 余白のある軸は枠幅だけで計算した範囲より狭い', () => {
    const box = { width: 600, height: 400 }
    const nat = { width: 300, height: 600 } // 表示は200x400(左右に200ずつ余白)
    const b = panBounds(2, box, nat)
    // 拡大後の幅400 < 枠幅600 → 写真が枠内に収まる範囲。中央配置はt=-300で、±100だけ動ける
    // (枠幅基準で計算すると-600〜0になり、写真を余白側へ大きく動かせてしまう)
    expect(b.minTx).toBeCloseTo(-400)
    expect(b.maxTx).toBeCloseTo(-200)
    // 縦は枠いっぱい(400)で拡大後800 → 覆う範囲
    expect(b.minTy).toBeCloseTo(-400)
    expect(b.maxTy).toBeCloseTo(0)
  })

  it('natural未取得なら枠いっぱいとして扱う', () => {
    expect(containedSize(BOX, null)).toEqual(BOX)
  })
})

describe('double tap', () => {
  it('等倍 → 2.5倍', () => {
    const s = applyDoubleTap(ID, { x: 200, y: 300 }, BOX, null)
    expect(s.scale).toBe(DOUBLE_TAP_SCALE)
    expect(DOUBLE_TAP_SCALE).toBe(2.5)
  })

  it('タップ位置基準: タップした点の下のコンテンツ位置が変わらない', () => {
    const p = { x: 100, y: 150 }
    const s = applyDoubleTap(ID, p, BOX, null)
    const q = contentAt(s, p)
    expect(q.x).toBeCloseTo(100)
    expect(q.y).toBeCloseTo(150)
  })

  it('中央タップは中央基準(tx,tyが中央を保つ値)', () => {
    const s = applyDoubleTap(ID, { x: 200, y: 300 }, BOX, null)
    expect(s.tx).toBeCloseTo(200 - 200 * 2.5)
    expect(s.ty).toBeCloseTo(300 - 300 * 2.5)
  })

  it('拡大中のダブルタップ → 1倍・tx=ty=0', () => {
    const zoomed: ZoomPanState = { scale: 3, tx: -123, ty: -45 }
    expect(applyDoubleTap(zoomed, { x: 10, y: 10 }, BOX, null)).toEqual({ scale: 1, tx: 0, ty: 0 })
  })
})

describe('zoomAround', () => {
  it('範囲外のscaleはclampされる', () => {
    expect(zoomAround(ID, { x: 0, y: 0 }, 99, BOX, null).scale).toBe(ZOOM_MAX_SCALE)
  })
})

describe('pinch', () => {
  it('開始中点基準: 中点の下のコンテンツが動かずズームする', () => {
    const a = { x: 80, y: 190 }
    const b = { x: 120, y: 210 } // 中点(100,200)
    const start = startPinch(ID, a, b)
    const a2 = { x: 60, y: 180 }
    const b2 = { x: 140, y: 220 } // 距離2倍・中点同じ
    const s = applyPinch(start, a2, b2, BOX, null)
    expect(s.scale).toBeCloseTo(2)
    const q = contentAt(s, { x: 100, y: 200 })
    expect(q.x).toBeCloseTo(100)
    expect(q.y).toBeCloseTo(200)
  })

  it('中点が移動すると、その分パンも反映される', () => {
    const start = startPinch(ID, { x: 150, y: 250 }, { x: 250, y: 350 }) // 中点(200,300)
    const stay = applyPinch(start, { x: 100, y: 200 }, { x: 300, y: 400 }, BOX, null) // 2倍・中点同じ
    const moved = applyPinch(start, { x: 120, y: 200 }, { x: 320, y: 400 }, BOX, null) // 2倍・中点が+20
    expect(moved.scale).toBeCloseTo(2)
    expect(moved.tx - stay.tx).toBeCloseTo(20)
    expect(moved.ty - stay.ty).toBeCloseTo(0)
  })

  it('1倍未満にならず、等倍に戻ればtx=ty=0', () => {
    const start = startPinch({ scale: 2, tx: -100, ty: -100 }, { x: 100, y: 100 }, { x: 300, y: 100 })
    expect(applyPinch(start, { x: 199, y: 100 }, { x: 201, y: 100 }, BOX, null)).toEqual({ scale: 1, tx: 0, ty: 0 })
  })

  it('4倍を超えない', () => {
    const start = startPinch(ID, { x: 190, y: 300 }, { x: 210, y: 300 })
    expect(applyPinch(start, { x: 0, y: 300 }, { x: 400, y: 300 }, BOX, null).scale).toBe(ZOOM_MAX_SCALE)
  })
})

describe('controller: gestures', () => {
  const tap = (c: ReturnType<typeof createZoomPanController>, x: number, y: number, t: number, id = 1) => {
    c.pointerDown({ id, x, y, time: t }, BOX)
    c.pointerUp({ id, x, y, time: t + 40 }, BOX)
  }

  it('ダブルタップ: 等倍→2.5倍→1倍、3・4回目の連打は新しいダブルタップにならない', () => {
    const c = createZoomPanController()
    tap(c, 100, 100, 0)
    tap(c, 102, 101, 150)
    expect(c.getState().scale).toBe(2.5)
    // 3回目・4回目の連打(ロック期間内)は無視される
    tap(c, 100, 100, 300)
    tap(c, 100, 100, 420)
    expect(c.getState().scale).toBe(2.5)
    // ロック明けの新しいダブルタップで1倍へ
    tap(c, 100, 100, 1000)
    tap(c, 100, 100, 1150)
    expect(c.getState()).toEqual({ scale: 1, tx: 0, ty: 0 })
  })

  it('間隔が長い/位置が離れた2タップはダブルタップにならない', () => {
    const c = createZoomPanController()
    tap(c, 100, 100, 0)
    tap(c, 100, 100, 600)
    expect(c.getState().scale).toBe(1)
    tap(c, 10, 10, 2000)
    tap(c, 300, 500, 2100)
    expect(c.getState().scale).toBe(1)
  })

  it('等倍では1本指ドラッグでパンしない', () => {
    const c = createZoomPanController()
    c.pointerDown({ id: 1, x: 100, y: 100, time: 0 }, BOX)
    c.pointerMove({ id: 1, x: 160, y: 160, time: 50 }, BOX)
    expect(c.getState()).toEqual({ scale: 1, tx: 0, ty: 0 })
  })

  it('拡大中は1本指でパンでき、範囲を超えない', () => {
    const c = createZoomPanController()
    tap(c, 200, 300, 0)
    tap(c, 200, 300, 150) // 2.5倍(中央基準)
    const before = c.getState()
    c.pointerDown({ id: 1, x: 200, y: 300, time: 1000 }, BOX)
    c.pointerMove({ id: 1, x: 250, y: 330, time: 1050 }, BOX)
    const moved = c.getState()
    expect(moved.tx - before.tx).toBeCloseTo(Math.min(50, 0 - before.tx))
    c.pointerMove({ id: 1, x: 9999, y: 9999, time: 1100 }, BOX)
    expect(c.getState().tx).toBeLessThanOrEqual(0) // 覆う範囲の上限(maxTx=0)を超えない
    expect(c.getState().ty).toBeLessThanOrEqual(0)
  })

  it('ピンチ後に1本離すと、残った1本でパンを継続できる', () => {
    const c = createZoomPanController()
    c.pointerDown({ id: 1, x: 150, y: 300, time: 0 }, BOX)
    c.pointerDown({ id: 2, x: 250, y: 300, time: 5 }, BOX)
    c.pointerMove({ id: 2, x: 350, y: 300, time: 30 }, BOX) // 距離2倍→約2倍
    expect(c.getState().scale).toBeGreaterThan(1.5)
    c.pointerUp({ id: 2, x: 350, y: 300, time: 60 }, BOX)
    const before = c.getState()
    c.pointerMove({ id: 1, x: 130, y: 300, time: 90 }, BOX) // 残った指が左へ
    expect(c.getState().tx).toBeLessThan(before.tx)
  })

  it('ピンチに使った指の離し方はダブルタップとして扱われない', () => {
    const c = createZoomPanController()
    c.pointerDown({ id: 1, x: 100, y: 100, time: 0 }, BOX)
    c.pointerDown({ id: 2, x: 140, y: 100, time: 5 }, BOX)
    c.pointerUp({ id: 2, x: 140, y: 100, time: 50 }, BOX)
    c.pointerUp({ id: 1, x: 100, y: 100, time: 60 }, BOX)
    tap(c, 100, 100, 120)
    expect(c.getState().scale).toBe(1)
  })

  it('reset()で全状態が初期化される', () => {
    const c = createZoomPanController()
    tap(c, 100, 100, 0)
    tap(c, 100, 100, 150)
    c.reset()
    expect(c.getState()).toEqual({ scale: 1, tx: 0, ty: 0 })
  })
})

describe('controller: 左右独立state', () => {
  it('左を操作しても右のstateに影響しない(逆も同様)・同時操作も独立', () => {
    const left = createZoomPanController()
    const right = createZoomPanController()
    // 左: ダブルタップで拡大
    left.pointerDown({ id: 1, x: 100, y: 100, time: 0 }, BOX)
    left.pointerUp({ id: 1, x: 100, y: 100, time: 40 }, BOX)
    left.pointerDown({ id: 1, x: 100, y: 100, time: 150 }, BOX)
    left.pointerUp({ id: 1, x: 100, y: 100, time: 190 }, BOX)
    expect(left.getState().scale).toBe(2.5)
    expect(right.getState()).toEqual({ scale: 1, tx: 0, ty: 0 })

    // 右: 同じpointerIdでピンチ(別コントローラなので衝突しない)。左は不変。
    const leftBefore = { ...left.getState() }
    right.pointerDown({ id: 1, x: 150, y: 300, time: 1000 }, BOX)
    right.pointerDown({ id: 2, x: 250, y: 300, time: 1005 }, BOX)
    right.pointerMove({ id: 2, x: 330, y: 300, time: 1030 }, BOX)
    expect(right.getState().scale).toBeGreaterThan(1)
    expect(left.getState()).toEqual(leftBefore)
  })

  it('onChangeはそのコントローラの変化のみ通知する', () => {
    const calls: string[] = []
    const left = createZoomPanController(() => calls.push('L'))
    const right = createZoomPanController(() => calls.push('R'))
    right.pointerDown({ id: 1, x: 100, y: 100, time: 0 }, BOX)
    right.pointerUp({ id: 1, x: 100, y: 100, time: 40 }, BOX)
    right.pointerDown({ id: 1, x: 100, y: 100, time: 150 }, BOX)
    right.pointerUp({ id: 1, x: 100, y: 100, time: 190 }, BOX)
    expect(calls).toEqual(['R'])
    left.reset()
    expect(calls).toEqual(['R']) // 既に初期状態のleftは通知しない
  })
})
