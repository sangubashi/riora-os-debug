// ================================================================
// useFacialSchemaCanvas.ts — 座標正規化・パームリジェクションのテスト
//
// このプロジェクトには@testing-library/react等が無く、フック本体(useFacialSchemaCanvas)
// をレンダリングしてテストすることはできない(tests/hooks/usePhotoCapture.test.ts冒頭の
// コメントと同じ制約)。そのため、フックが内部で使う判定ロジックをDOM/Reactに依存しない
// 純粋関数としてexportしたもの(clamp01・toNormalizedPoint・decidePointerDown・
// decidePointerEnd)を直接呼び出して検証する。
// ================================================================
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FACIAL_SCHEMA_STROKE_WIDTH,
  INITIAL_POINTER_TRACK_STATE,
  clamp01,
  decidePointerDown,
  decidePointerEnd,
  toNormalizedPoint,
  type PointerTrackState,
} from '../../../src/lib/facialSchema/useFacialSchemaCanvas'

describe('clamp01', () => {
  it('0〜1の範囲内はそのまま返す', () => {
    expect(clamp01(0.5)).toBe(0.5)
    expect(clamp01(0)).toBe(0)
    expect(clamp01(1)).toBe(1)
  })

  it('範囲外は0または1にクランプする', () => {
    expect(clamp01(-0.3)).toBe(0)
    expect(clamp01(1.7)).toBe(1)
  })

  it('NaNは0として扱う', () => {
    expect(clamp01(NaN)).toBe(0)
  })
})

describe('toNormalizedPoint', () => {
  const rect = { left: 100, top: 200, width: 800, height: 1200 }

  it('コンテナ左上を(0,0)、右下を(1,1)として正規化する', () => {
    expect(toNormalizedPoint(100, 200, rect)).toEqual({ x: 0, y: 0 })
    expect(toNormalizedPoint(900, 1400, rect)).toEqual({ x: 1, y: 1 })
  })

  it('中央付近は0.5前後になる', () => {
    const p = toNormalizedPoint(500, 800, rect)
    expect(p.x).toBeCloseTo(0.5, 5)
    expect(p.y).toBeCloseTo(0.5, 5)
  })

  it('コンテナの外側(左上より外)にはみ出した場合は0にクランプする', () => {
    expect(toNormalizedPoint(0, 0, rect)).toEqual({ x: 0, y: 0 })
  })

  it('コンテナの外側(右下より外)にはみ出した場合は1にクランプする', () => {
    expect(toNormalizedPoint(2000, 3000, rect)).toEqual({ x: 1, y: 1 })
  })

  it('rectのwidth/heightが0以下(未計測)の場合は安全に(0,0)を返す', () => {
    expect(toNormalizedPoint(500, 500, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 })
  })
})

describe('decidePointerDown — パームリジェクション', () => {
  it('未描画状態からの通常のpointerdownはstartを返し、そのポインタをアクティブにする', () => {
    const decision = decidePointerDown(INITIAL_POINTER_TRACK_STATE, 1, 'touch')
    expect(decision.action).toBe('start')
    expect(decision.nextState).toEqual({ activePointerId: 1, activePointerType: 'touch' })
  })

  it('Apple Pencil(pen)での描画開始も同様にstartを返す', () => {
    const decision = decidePointerDown(INITIAL_POINTER_TRACK_STATE, 1, 'pen')
    expect(decision.action).toBe('start')
    expect(decision.nextState.activePointerType).toBe('pen')
  })

  it('①ペンで描画中に別のtouch(手のひら)が触れても無視し、ペンの描画を継続させる', () => {
    const state: PointerTrackState = { activePointerId: 1, activePointerType: 'pen' }
    const decision = decidePointerDown(state, 2, 'touch')
    expect(decision.action).toBe('ignore')
    expect(decision.nextState).toEqual(state) // 状態は変えない(ペンの描画を維持)
  })

  it('②指のみで描画中に別のtouchが増えたら、手のひら疑いとして進行中のストロークをキャンセルする', () => {
    const state: PointerTrackState = { activePointerId: 1, activePointerType: 'touch' }
    const decision = decidePointerDown(state, 2, 'touch')
    expect(decision.action).toBe('cancel_active_and_ignore')
    expect(decision.nextState).toEqual(INITIAL_POINTER_TRACK_STATE)
  })

  it('指で描画中に途中からペンが降りてきた場合はペンを優先して描画を切り替える', () => {
    const state: PointerTrackState = { activePointerId: 1, activePointerType: 'touch' }
    const decision = decidePointerDown(state, 2, 'pen')
    expect(decision.action).toBe('start')
    expect(decision.nextState).toEqual({ activePointerId: 2, activePointerType: 'pen' })
  })

  it('同一ポインタからの重複pointerdownは無視し、状態を変えない', () => {
    const state: PointerTrackState = { activePointerId: 1, activePointerType: 'touch' }
    const decision = decidePointerDown(state, 1, 'touch')
    expect(decision.action).toBe('ignore')
    expect(decision.nextState).toEqual(state)
  })

  it('未知のpointerTypeはmouse相当として扱う(安全側)', () => {
    const decision = decidePointerDown(INITIAL_POINTER_TRACK_STATE, 1, 'unknown_future_type')
    expect(decision.nextState.activePointerType).toBe('mouse')
  })

  it('mouseで描画中に別のmouse入力が来た場合も手のひら判定と同じ扱い(キャンセル)になる', () => {
    // 通常のマウス操作では起こらないが、複数ポインタが同時に来た場合の安全側の挙動として確認する。
    const state: PointerTrackState = { activePointerId: 1, activePointerType: 'mouse' }
    const decision = decidePointerDown(state, 2, 'mouse')
    expect(decision.action).toBe('cancel_active_and_ignore')
  })
})

describe('decidePointerEnd', () => {
  it('現在アクティブなポインタのpointerup/cancelはisActivePointer=trueで状態をリセットする', () => {
    const state: PointerTrackState = { activePointerId: 1, activePointerType: 'touch' }
    const decision = decidePointerEnd(state, 1)
    expect(decision.isActivePointer).toBe(true)
    expect(decision.nextState).toEqual(INITIAL_POINTER_TRACK_STATE)
  })

  it('アクティブでない(無視されていた)ポインタのpointerup/cancelは何もしない', () => {
    const state: PointerTrackState = { activePointerId: 1, activePointerType: 'pen' }
    const decision = decidePointerEnd(state, 2)
    expect(decision.isActivePointer).toBe(false)
    expect(decision.nextState).toEqual(state) // 状態は変えない
  })

  it('誰も描画していない状態でのpointerup/cancelは何もしない', () => {
    const decision = decidePointerEnd(INITIAL_POINTER_TRACK_STATE, 1)
    expect(decision.isActivePointer).toBe(false)
  })
})

describe('定数', () => {
  it('DEFAULT_FACIAL_SCHEMA_STROKE_WIDTHは正の値である', () => {
    expect(DEFAULT_FACIAL_SCHEMA_STROKE_WIDTH).toBeGreaterThan(0)
  })

  it('INITIAL_POINTER_TRACK_STATEは非アクティブ状態を表す', () => {
    expect(INITIAL_POINTER_TRACK_STATE).toEqual({ activePointerId: null, activePointerType: null })
  })
})
