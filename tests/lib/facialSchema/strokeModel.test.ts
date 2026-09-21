// ================================================================
// strokeModel.ts — ストロークの追加・Undo・クリア・パースのテスト
// ================================================================
import { describe, expect, it } from 'vitest'
import {
  FACIAL_SCHEMA_STROKES_VERSION,
  addStroke,
  clearStrokes,
  createEmptyStrokesData,
  parseStrokesData,
  undoLastStroke,
  type Stroke,
  type StrokesData,
} from '../../../src/lib/facialSchema/strokeModel'

function stroke(overrides: Partial<Stroke> = {}): Stroke {
  return {
    id: 's1',
    category: 'acne',
    tool: 'point',
    points: [{ x: 0.4, y: 0.5 }],
    width: 0.01,
    ...overrides,
  }
}

describe('createEmptyStrokesData', () => {
  it('現行versionで空のstrokes配列を返す', () => {
    expect(createEmptyStrokesData()).toEqual({ version: FACIAL_SCHEMA_STROKES_VERSION, strokes: [] })
  })
})

describe('addStroke', () => {
  it('末尾に1ストロークを追加した新しいオブジェクトを返す(元のオブジェクトは変更しない)', () => {
    const original = createEmptyStrokesData()
    const s = stroke()
    const result = addStroke(original, s)

    expect(result.strokes).toEqual([s])
    expect(original.strokes).toEqual([]) // 元のオブジェクトはイミュータブル
    expect(result).not.toBe(original)
  })

  it('複数回addStrokeすると入力順に積み上がる', () => {
    let data = createEmptyStrokesData()
    const s1 = stroke({ id: 's1' })
    const s2 = stroke({ id: 's2' })
    data = addStroke(data, s1)
    data = addStroke(data, s2)
    expect(data.strokes.map(s => s.id)).toEqual(['s1', 's2'])
  })
})

describe('undoLastStroke', () => {
  it('最後の1ストロークを取り除いた新しいオブジェクトを返す', () => {
    const s1 = stroke({ id: 's1' })
    const s2 = stroke({ id: 's2' })
    const data: StrokesData = { version: FACIAL_SCHEMA_STROKES_VERSION, strokes: [s1, s2] }

    const result = undoLastStroke(data)
    expect(result.strokes.map(s => s.id)).toEqual(['s1'])
    expect(data.strokes).toHaveLength(2) // 元のオブジェクトは変更しない
  })

  it('ストロークが1つも無い場合は元のデータをそのまま返す(空配列のまま、例外を投げない)', () => {
    const empty = createEmptyStrokesData()
    expect(undoLastStroke(empty)).toBe(empty)
  })

  it('複数回Undoすると1つずつ減っていく', () => {
    let data: StrokesData = {
      version: FACIAL_SCHEMA_STROKES_VERSION,
      strokes: [stroke({ id: 'a' }), stroke({ id: 'b' }), stroke({ id: 'c' })],
    }
    data = undoLastStroke(data)
    expect(data.strokes.map(s => s.id)).toEqual(['a', 'b'])
    data = undoLastStroke(data)
    expect(data.strokes.map(s => s.id)).toEqual(['a'])
    data = undoLastStroke(data)
    expect(data.strokes).toEqual([])
  })
})

describe('clearStrokes', () => {
  it('全ストロークを消去した新しいオブジェクトを返す(versionは維持)', () => {
    const data: StrokesData = {
      version: FACIAL_SCHEMA_STROKES_VERSION,
      strokes: [stroke({ id: 'a' }), stroke({ id: 'b' })],
    }
    const result = clearStrokes(data)
    expect(result.strokes).toEqual([])
    expect(result.version).toBe(FACIAL_SCHEMA_STROKES_VERSION)
    expect(data.strokes).toHaveLength(2) // 元のオブジェクトは変更しない
  })

  it('既に空の場合は同じ参照を返す(無駄な再レンダリングを避ける)', () => {
    const empty = createEmptyStrokesData()
    expect(clearStrokes(empty)).toBe(empty)
  })
})

describe('parseStrokesData', () => {
  it('正常な形のデータをそのままパースする', () => {
    const raw = {
      version: FACIAL_SCHEMA_STROKES_VERSION,
      strokes: [
        { id: 's1', category: 'redness', tool: 'area', width: 0.02, points: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }] },
      ],
    }
    const result = parseStrokesData(raw)
    expect(result.version).toBe(FACIAL_SCHEMA_STROKES_VERSION)
    expect(result.strokes).toHaveLength(1)
    expect(result.strokes[0]).toEqual(raw.strokes[0])
  })

  it('version不一致の場合は空のStrokesDataへフォールバックする(推測変換はしない)', () => {
    const raw = { version: 999, strokes: [stroke()] }
    expect(parseStrokesData(raw)).toEqual(createEmptyStrokesData())
  })

  it('null・非オブジェクト・strokesが配列でない場合は空のStrokesDataへフォールバックする', () => {
    expect(parseStrokesData(null)).toEqual(createEmptyStrokesData())
    expect(parseStrokesData(undefined)).toEqual(createEmptyStrokesData())
    expect(parseStrokesData('not an object')).toEqual(createEmptyStrokesData())
    expect(parseStrokesData({ version: FACIAL_SCHEMA_STROKES_VERSION, strokes: 'not an array' })).toEqual(createEmptyStrokesData())
  })

  it('不正な個々のストロークだけを除外し、正常なストロークは残す', () => {
    const good = { id: 'good', category: 'acne', tool: 'point', width: 0.01, points: [{ x: 0.5, y: 0.5 }] }
    const raw = {
      version: FACIAL_SCHEMA_STROKES_VERSION,
      strokes: [
        good,
        { id: 'bad-category', category: 'unknown_category', tool: 'point', width: 0.01, points: [{ x: 0.1, y: 0.1 }] },
        { id: 'bad-tool', category: 'acne', tool: 'not_a_tool', width: 0.01, points: [{ x: 0.1, y: 0.1 }] },
        { id: 'bad-width', category: 'acne', tool: 'point', width: -1, points: [{ x: 0.1, y: 0.1 }] },
        { id: 'bad-points', category: 'acne', tool: 'point', width: 0.01, points: [] },
        { id: '', category: 'acne', tool: 'point', width: 0.01, points: [{ x: 0.1, y: 0.1 }] }, // id空文字は不正
        'not an object at all',
      ],
    }
    const result = parseStrokesData(raw)
    expect(result.strokes).toEqual([good]) // 正常な1件だけが残る
  })

  it('ストローク内の不正な座標点のみを取り除き、有効な点だけ残す', () => {
    const raw = {
      version: FACIAL_SCHEMA_STROKES_VERSION,
      strokes: [
        {
          id: 's1', category: 'hifu_treated', tool: 'line', width: 0.015,
          points: [{ x: 0.1, y: 0.1 }, { x: 'invalid', y: 0.2 }, { x: 0.3, y: 0.3 }],
        },
      ],
    }
    const result = parseStrokesData(raw)
    expect(result.strokes[0].points).toEqual([{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.3 }])
  })

  it('全ての座標点が不正なストロークは丸ごと除外する', () => {
    const raw = {
      version: FACIAL_SCHEMA_STROKES_VERSION,
      strokes: [
        { id: 's1', category: 'acne', tool: 'point', width: 0.01, points: [{ x: 'a', y: 'b' }] },
      ],
    }
    expect(parseStrokesData(raw).strokes).toEqual([])
  })
})
