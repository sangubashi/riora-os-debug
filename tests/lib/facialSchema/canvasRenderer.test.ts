// ================================================================
// canvasRenderer.ts — ストローク配列(正規化座標0〜1)のCanvas描画のテスト
//
// 実DOMのCanvasRenderingContext2Dは使わず、RenderCanvasContextのプレーン
// モック(vi.fn()のスパイ)を渡して検証する(captureFrame.test.tsのfakeCanvas()と
// 同じ方針)。
// ================================================================
import { describe, expect, it, vi } from 'vitest'
import { renderStroke, renderStrokes, type RenderBox, type RenderCanvasContext } from '../../../src/lib/facialSchema/canvasRenderer'
import { getCategoryStyle } from '../../../src/lib/facialSchema/facialSchemaCategories'
import type { Stroke } from '../../../src/lib/facialSchema/strokeModel'

function fakeContext(): RenderCanvasContext {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    setLineDash: vi.fn(),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    lineCap: '',
    lineJoin: '',
    globalAlpha: 1,
  }
}

const box: RenderBox = { width: 800, height: 1200 }

function pointStroke(overrides: Partial<Stroke> = {}): Stroke {
  return { id: 's1', category: 'acne', tool: 'point', points: [{ x: 0.25, y: 0.5 }], width: 0.02, ...overrides }
}

describe('renderStroke — tool=point(ニキビ)', () => {
  it('先頭の1点を正規化座標からpx座標へ変換してarcで塗りつぶし円を描く', () => {
    const ctx = fakeContext()
    renderStroke(ctx, pointStroke(), box)

    // x=0.25*800=200, y=0.5*1200=600, radius=width(0.02)*box.width(800)=16
    expect(ctx.arc).toHaveBeenCalledWith(200, 600, 16, 0, Math.PI * 2)
    expect(ctx.fill).toHaveBeenCalledTimes(1)
    expect(ctx.stroke).not.toHaveBeenCalled()
    expect(ctx.fillStyle).toBe(getCategoryStyle('acne').color)
  })

  it('描画をsave/restoreで挟む(前後のスタイル汚染を防ぐ)', () => {
    const ctx = fakeContext()
    renderStroke(ctx, pointStroke(), box)
    expect(ctx.save).toHaveBeenCalledTimes(1)
    expect(ctx.restore).toHaveBeenCalledTimes(1)
  })
})

describe('renderStroke — tool=area(赤み・毛穴)', () => {
  it('2点以上ある場合、軌跡をカテゴリの半透明色でstrokeする(塗りつぶし多角形にはしない)', () => {
    const ctx = fakeContext()
    const stroke: Stroke = {
      id: 's2', category: 'redness', tool: 'area', width: 0.03,
      points: [{ x: 0.1, y: 0.2 }, { x: 0.4, y: 0.6 }],
    }
    renderStroke(ctx, stroke, box)

    expect(ctx.moveTo).toHaveBeenCalledWith(80, 240)   // 0.1*800, 0.2*1200
    expect(ctx.lineTo).toHaveBeenCalledWith(320, 720)  // 0.4*800, 0.6*1200
    expect(ctx.stroke).toHaveBeenCalledTimes(1)
    expect(ctx.fill).not.toHaveBeenCalled()
    expect(ctx.setLineDash).toHaveBeenCalledWith([])
    expect(ctx.strokeStyle).toBe(getCategoryStyle('redness').color)
    expect(ctx.lineWidth).toBe(0.03 * box.width)
    expect(ctx.globalAlpha).toBe(getCategoryStyle('redness').fillOpacity)
  })

  it('毛穴カテゴリも同じarea描画ロジック(色が異なるだけ)で描かれる', () => {
    const ctx = fakeContext()
    const stroke: Stroke = {
      id: 's3', category: 'pores', tool: 'area', width: 0.03,
      points: [{ x: 0.2, y: 0.2 }, { x: 0.3, y: 0.3 }],
    }
    renderStroke(ctx, stroke, box)
    expect(ctx.strokeStyle).toBe(getCategoryStyle('pores').color)
    expect(ctx.strokeStyle).not.toBe(getCategoryStyle('redness').color)
  })

  it('points が1点しかない場合はtool=pointと同じ塗りつぶし円にフォールバックする', () => {
    const ctx = fakeContext()
    const stroke: Stroke = { id: 's4', category: 'redness', tool: 'area', width: 0.02, points: [{ x: 0.5, y: 0.5 }] }
    renderStroke(ctx, stroke, box)
    expect(ctx.arc).toHaveBeenCalledTimes(1)
    expect(ctx.fill).toHaveBeenCalledTimes(1)
    expect(ctx.stroke).not.toHaveBeenCalled()
  })
})

describe('renderStroke — tool=line(HIFU範囲)', () => {
  it('HIFU実施(hifu_treated)は実線(空のlineDash)で描く', () => {
    const ctx = fakeContext()
    const stroke: Stroke = {
      id: 's5', category: 'hifu_treated', tool: 'line', width: 0.01,
      points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    }
    renderStroke(ctx, stroke, box)
    expect(ctx.setLineDash).toHaveBeenCalledWith([])
    expect(ctx.strokeStyle).toBe(getCategoryStyle('hifu_treated').color)
    expect(ctx.globalAlpha).toBe(1) // lineツールは不透明(areaのfillOpacityの影響を受けない)
  })

  it('HIFU回避(hifu_avoided)は破線で描く', () => {
    const ctx = fakeContext()
    const stroke: Stroke = {
      id: 's6', category: 'hifu_avoided', tool: 'line', width: 0.01,
      points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    }
    renderStroke(ctx, stroke, box)
    const expectedDash = getCategoryStyle('hifu_avoided').lineDash!
    expect(expectedDash.length).toBeGreaterThan(0)
    expect(ctx.setLineDash).toHaveBeenCalledWith(expectedDash)
  })

  it('points が1点しかない場合はtool=pointと同じ塗りつぶし円にフォールバックする', () => {
    const ctx = fakeContext()
    const stroke: Stroke = { id: 's7', category: 'hifu_treated', tool: 'line', width: 0.01, points: [{ x: 0.5, y: 0.5 }] }
    renderStroke(ctx, stroke, box)
    expect(ctx.arc).toHaveBeenCalledTimes(1)
  })
})

describe('renderStrokes — 複数ストロークの一括描画', () => {
  it('入力順に全ストロークを描画する(件数分だけsave/restoreされる)', () => {
    const ctx = fakeContext()
    const strokes: Stroke[] = [
      pointStroke({ id: 'a' }),
      pointStroke({ id: 'b', category: 'redness' }),
      pointStroke({ id: 'c', category: 'hifu_treated' }),
    ]
    renderStrokes(ctx, strokes, box)
    expect(ctx.save).toHaveBeenCalledTimes(3)
    expect(ctx.restore).toHaveBeenCalledTimes(3)
  })

  it('空配列を渡した場合は何も描画しない', () => {
    const ctx = fakeContext()
    renderStrokes(ctx, [], box)
    expect(ctx.save).not.toHaveBeenCalled()
    expect(ctx.arc).not.toHaveBeenCalled()
  })
})
