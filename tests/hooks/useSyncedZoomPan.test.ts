import { describe, it, expect } from 'vitest'
import { clamp, panBound, zoomAround, ZOOM_MAX_SCALE } from '@/hooks/useSyncedZoomPan'

describe('useSyncedZoomPan 純粋関数', () => {
  it('clamp', () => {
    expect(clamp(5, 1, 4)).toBe(4)
    expect(clamp(-1, 0, 4)).toBe(0)
  })
  it('panBound: 等倍では0、拡大するほど領域の半分ずつ広がる', () => {
    expect(panBound(1, 400)).toBe(0)
    expect(panBound(2, 400)).toBe(200)
    expect(panBound(3, 400)).toBe(400)
    expect(ZOOM_MAX_SCALE).toBe(4)
  })
  it('zoomAround: 指定点の下の内容が動かない(画面位置 = t + s*p が保存される)', () => {
    const t0 = { x: 10, y: -5 }, s0 = 1.5, s1 = 3, focal = { x: 80, y: 40 }
    // focalの下にある元座標p: focal = t0 + s0*p
    const p = { x: (focal.x - t0.x) / s0, y: (focal.y - t0.y) / s0 }
    const t1 = zoomAround(t0, s0, s1, focal)
    expect(t1.x + s1 * p.x).toBeCloseTo(focal.x)
    expect(t1.y + s1 * p.y).toBeCloseTo(focal.y)
  })
  it('zoomAround: 領域中心(focal=0)での拡大は平行移動も比例する', () => {
    expect(zoomAround({ x: 0, y: 0 }, 1, 2, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 })
  })
})
