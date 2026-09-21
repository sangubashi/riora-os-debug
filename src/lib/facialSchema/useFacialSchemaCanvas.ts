'use client'
/**
 * useFacialSchemaCanvas.ts — 顔シェーマ描画用のReactバインディング(Phase 4)。
 *
 * Pointer Events(onPointerDown/Move/Up/Cancel)を自前実装する(外部ライブラリを
 * 追加しない、src/components/customer/guestMode/usePinchZoom.ts・useLongPress.tsと
 * 同じプロジェクト方針)。ストローク配列の操作(追加/Undo/クリア)はstrokeModel.tsに、
 * 描画そのものはcanvasRenderer.tsに委譲する(usePhotoCapture.tsがcaptureFrame.tsへ
 * ロジックを委譲するのと同じ設計)。
 *
 * パームリジェクション・座標正規化はReact/DOMに依存しない純粋関数として本ファイル内に
 * exportしており、フック本体をレンダリングせずにテストできる。このプロジェクトには
 * @testing-library/react等が無くフック単体をレンダリングしてテストできないため
 * (tests/hooks/usePhotoCapture.test.ts冒頭のコメント参照)、usePhotoCapture.tsの
 * CAMERA_CONSTRAINTS exportと同じ「ロジックを純粋関数として切り出しexportする」方針を
 * 踏襲する。
 *
 * ライブ描画プレビューの設計判断: pointermoveのたびにReact stateを更新すると
 * 再レンダリングコストが大きいため、進行中のストローク(現在描画中の1筆)はrefで保持し、
 * 座標の追記自体はsetStateを介さない。呼び出し側(Phase 5)が滑らかなプレビューを
 * 描画したい場合は、getCurrentStroke()で都度取得し、canvasRenderer.renderStroke()で
 * 自前のアニメーションループ(requestAnimationFrame等)から描画すること。ストロークの
 * 確定(pointerup)時のみstrokesDataへコミットし、Reactの再レンダリングが発生する。
 */
import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent, type MutableRefObject } from 'react'
import {
  DEFAULT_FACIAL_SCHEMA_CATEGORY,
  getCategoryStyle,
  type FacialSchemaCategory,
} from './facialSchemaCategories'
import {
  addStroke,
  clearStrokes,
  createEmptyStrokesData,
  undoLastStroke,
  type Stroke,
  type StrokePoint,
  type StrokesData,
} from './strokeModel'

/** ストロークの正規化線幅/点半径の既定値(strokeModel.tsのwidth、テンプレート幅基準)。 */
export const DEFAULT_FACIAL_SCHEMA_STROKE_WIDTH = 0.012

// ================================================================
// 純粋関数(DOM/Reactに非依存、ユニットテスト対象)
// ================================================================

/** 0〜1の範囲へクランプする(NaNは0として扱う)。 */
export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0
  return Math.min(1, Math.max(0, value))
}

export interface ClientRectLike {
  left:   number
  top:    number
  width:  number
  height: number
}

/**
 * ポインタのクライアント座標(clientX/clientY)を、描画コンテナの実寸(rect)に対する
 * 正規化座標(0〜1)へ変換する。境界外にはみ出した場合はクランプする(指がテンプレート
 * 画像の外へ出ても保存データが範囲外座標を持たないようにするため)。rect.width/height
 * が0以下(未計測・非表示中)の場合は安全に(0,0)を返す。
 */
export function toNormalizedPoint(clientX: number, clientY: number, rect: ClientRectLike): StrokePoint {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 }
  return {
    x: clamp01((clientX - rect.left) / rect.width),
    y: clamp01((clientY - rect.top) / rect.height),
  }
}

export type FacialSchemaPointerType = 'pen' | 'touch' | 'mouse'

function isTrackedPointerType(v: string): v is FacialSchemaPointerType {
  return v === 'pen' || v === 'touch' || v === 'mouse'
}

export interface PointerTrackState {
  activePointerId:   number | null
  activePointerType: FacialSchemaPointerType | null
}

export const INITIAL_POINTER_TRACK_STATE: PointerTrackState = {
  activePointerId:   null,
  activePointerType: null,
}

export type PointerDownAction = 'start' | 'ignore' | 'cancel_active_and_ignore'

export interface PointerDownDecision {
  action:    PointerDownAction
  nextState: PointerTrackState
}

/**
 * パームリジェクション本体(実装計画・2026-09-21確定方針)。
 * ①Apple Pencil(pointerType='pen')が描画中の間は、他の入力(手のひら等の'touch')を
 *   常に無視する(ペン優先。iPadの標準的なScribble系アプリと同じ考え方)。
 * ②指のみで描画中(activePointerType='touch')に別のtouchポインタが増えたら、
 *   一本指では物理的に起こり得ない=手のひら等が触れたとみなし、進行中のストローク
 *   自体をキャンセルする(誤って手のひらの軌跡が混ざったストロークが保存されるのを防ぐ)。
 * ③どちらでもなければそのまま描画を開始する(mouseでの描画・デバッグ用途も許可する)。
 * 未知のpointerType(将来のブラウザ拡張等)は'mouse'相当として扱う(安全側に倒す)。
 */
export function decidePointerDown(
  state: PointerTrackState,
  pointerId: number,
  rawPointerType: string
): PointerDownDecision {
  const pointerType: FacialSchemaPointerType = isTrackedPointerType(rawPointerType) ? rawPointerType : 'mouse'

  if (state.activePointerId === null) {
    return { action: 'start', nextState: { activePointerId: pointerId, activePointerType: pointerType } }
  }

  if (state.activePointerId === pointerId) {
    // 同一ポインタからのpointerdown重複(通常起きない)は無視する。
    return { action: 'ignore', nextState: state }
  }

  if (state.activePointerType === 'pen') {
    return { action: 'ignore', nextState: state } // ①ペン優先
  }

  if (pointerType === 'pen') {
    // 指で描画中に途中からペンが降りてきた場合はペンを優先させる(通常起きない想定だが安全側)。
    return { action: 'start', nextState: { activePointerId: pointerId, activePointerType: 'pen' } }
  }

  return { action: 'cancel_active_and_ignore', nextState: INITIAL_POINTER_TRACK_STATE } // ②手のひら疑い
}

export interface PointerEndDecision {
  /** 今終了したポインタが、現在描画中のポインタ本人だったか。falseなら何もしなくてよい。 */
  isActivePointer: boolean
  nextState:       PointerTrackState
}

/** pointerup/pointercancel共通の判定(呼び出し側がcommitするかどうかを分ける)。 */
export function decidePointerEnd(state: PointerTrackState, pointerId: number): PointerEndDecision {
  if (state.activePointerId !== pointerId) {
    return { isActivePointer: false, nextState: state }
  }
  return { isActivePointer: true, nextState: INITIAL_POINTER_TRACK_STATE }
}

// ================================================================
// Reactバインディング本体
// ================================================================

export interface UseFacialSchemaCanvasOptions {
  /** 初期表示するストローク(履歴から読み込む場合等)。省略時は空(初回マウント時のみ参照)。 */
  initialStrokesData?: StrokesData
  /** 初期選択カテゴリ。省略時はfacialSchemaCategories.tsの既定カテゴリ。 */
  initialCategory?:    FacialSchemaCategory
  /** 新規ストロークの正規化線幅/点半径(テンプレート幅基準)。 */
  strokeWidth?:        number
  /** 読み取り専用: pointerハンドラを一切バインドしない(閲覧専用画面向け、Phase 6用)。 */
  readOnly?:           boolean
}

export interface FacialSchemaPointerHandlers {
  onPointerDown?:   (e: ReactPointerEvent) => void
  onPointerMove?:   (e: ReactPointerEvent) => void
  onPointerUp?:     (e: ReactPointerEvent) => void
  onPointerCancel?: (e: ReactPointerEvent) => void
}

export interface UseFacialSchemaCanvasResult {
  strokesData: StrokesData
  category:    FacialSchemaCategory
  setCategory: (category: FacialSchemaCategory) => void
  isDrawing:   boolean
  canUndo:     boolean
  undo:        () => void
  clear:       () => void
  /** 履歴から過去のシェーマを読み込む等、strokesDataを丸ごと外部から差し替える。 */
  loadStrokesData: (data: StrokesData) => void
  /**
   * 描画コンテナ(テンプレート画像と同じ実寸の要素)に付けるref。座標正規化に使う。
   * 呼び出し側がref callback経由で.currentへ直接代入できるようMutableRefObjectにする
   * (RefObjectはcurrentがreadonlyのため、useRefの戻り値をそのまま公開する)。
   */
  containerRef: MutableRefObject<HTMLElement | null>
  /** 描画コンテナにそのままspreadするPointer Eventsハンドラ(readOnly時は空オブジェクト)。 */
  handlers: FacialSchemaPointerHandlers
  /**
   * 現在描画中(コミット前)のストロークを取得する(無ければnull)。ライブプレビュー用の
   * 命令的な読み取りAPI(setState経由ではない、ファイル冒頭のコメント参照)。
   */
  getCurrentStroke: () => Stroke | null
  /** 描画コンテナへ適用が必要なCSS(touch-action: 'none')。ブラウザ標準のスクロール/
   *  ピンチ操作と競合しないようにするため必須(usePinchZoom.ts・useLongPress.tsと同じ手法)。 */
  recommendedContainerStyle: { touchAction: 'none' }
}

function generateStrokeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `stroke-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function useFacialSchemaCanvas(
  options: UseFacialSchemaCanvasOptions = {}
): UseFacialSchemaCanvasResult {
  const { readOnly = false, strokeWidth = DEFAULT_FACIAL_SCHEMA_STROKE_WIDTH } = options

  const [strokesData, setStrokesData] = useState<StrokesData>(
    () => options.initialStrokesData ?? createEmptyStrokesData()
  )
  const [category, setCategory] = useState<FacialSchemaCategory>(
    () => options.initialCategory ?? DEFAULT_FACIAL_SCHEMA_CATEGORY
  )
  const [isDrawing, setIsDrawing] = useState(false)

  const containerRef      = useRef<HTMLElement | null>(null)
  const pointerTrackRef    = useRef<PointerTrackState>(INITIAL_POINTER_TRACK_STATE)
  const currentStrokeRef   = useRef<Stroke | null>(null)

  const getRect = useCallback((): ClientRectLike => {
    const el = containerRef.current
    if (!el) return { left: 0, top: 0, width: 0, height: 0 }
    const r = el.getBoundingClientRect()
    return { left: r.left, top: r.top, width: r.width, height: r.height }
  }, [])

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    const decision = decidePointerDown(pointerTrackRef.current, e.pointerId, e.pointerType)
    pointerTrackRef.current = decision.nextState

    if (decision.action === 'cancel_active_and_ignore') {
      // 手のひら疑いで進行中のストロークを破棄する(コミットしない)。
      currentStrokeRef.current = null
      setIsDrawing(false)
      return
    }
    if (decision.action === 'ignore') return

    const style = getCategoryStyle(category)
    const point = toNormalizedPoint(e.clientX, e.clientY, getRect())
    currentStrokeRef.current = {
      id:       generateStrokeId(),
      category,
      tool:     style.tool,
      points:   [point],
      width:    strokeWidth,
    }
    setIsDrawing(true)
  }, [category, strokeWidth, getRect])

  const onPointerMove = useCallback((e: ReactPointerEvent) => {
    const current = currentStrokeRef.current
    if (!current) return
    if (pointerTrackRef.current.activePointerId !== e.pointerId) return

    // tool='point'はタップ位置のみで確定するため、移動による追記は行わない
    // (ドラッグでの再配置は今回のスコープ外)。
    if (current.tool === 'point') return

    current.points.push(toNormalizedPoint(e.clientX, e.clientY, getRect()))
  }, [getRect])

  const finishStroke = useCallback((commit: boolean) => {
    const current = currentStrokeRef.current
    currentStrokeRef.current = null
    setIsDrawing(false)
    if (commit && current) {
      setStrokesData(prev => addStroke(prev, current))
    }
  }, [])

  const onPointerUp = useCallback((e: ReactPointerEvent) => {
    const decision = decidePointerEnd(pointerTrackRef.current, e.pointerId)
    pointerTrackRef.current = decision.nextState
    if (!decision.isActivePointer) return
    finishStroke(true)
  }, [finishStroke])

  const onPointerCancel = useCallback((e: ReactPointerEvent) => {
    const decision = decidePointerEnd(pointerTrackRef.current, e.pointerId)
    pointerTrackRef.current = decision.nextState
    if (!decision.isActivePointer) return
    finishStroke(false) // ブラウザ/OSによるキャンセルは保存しない
  }, [finishStroke])

  const undo = useCallback(() => {
    if (readOnly) return
    setStrokesData(prev => undoLastStroke(prev))
  }, [readOnly])

  const clear = useCallback(() => {
    if (readOnly) return
    setStrokesData(prev => clearStrokes(prev))
  }, [readOnly])

  const loadStrokesData = useCallback((data: StrokesData) => {
    setStrokesData(data)
    currentStrokeRef.current = null
    pointerTrackRef.current = INITIAL_POINTER_TRACK_STATE
    setIsDrawing(false)
  }, [])

  const getCurrentStroke = useCallback(() => currentStrokeRef.current, [])

  return {
    strokesData,
    category,
    setCategory,
    isDrawing,
    canUndo: strokesData.strokes.length > 0,
    undo,
    clear,
    loadStrokesData,
    containerRef,
    handlers: readOnly ? {} : { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
    getCurrentStroke,
    recommendedContainerStyle: { touchAction: 'none' },
  }
}
