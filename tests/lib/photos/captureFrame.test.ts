// ================================================================
// captureFrame.ts — videoフレームのみをcanvasに描画する(ゴーストを焼き込まない)ことの検証
// + 長辺1920pxへの縮小(必須修正3)・WebPエンコード結果の検証(必須修正4)
//
// 対応: docs/PHOTO_KARTE_UX_WIREFRAME_1.md 1-4節「保存画像にゴーストを焼き込まない」、
//   実装前レビュー必須修正3・4
// ================================================================
import { describe, expect, it, vi } from 'vitest'
import {
  MAX_CAPTURE_LONG_EDGE_PX,
  captureVideoFrameToBlob,
  computeResizedDimensions,
  verifyWebpBlob,
  type CaptureCanvas,
  type CaptureCanvasContext,
} from '../../../src/lib/photos/captureFrame'

function fakeCanvas(): { canvas: CaptureCanvas; ctx: CaptureCanvasContext } {
  const drawImage = vi.fn()
  const ctx: CaptureCanvasContext = { drawImage }
  const canvas: CaptureCanvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
  }
  return { canvas, ctx }
}

function webpBlob(bytes: string = 'x'): Blob {
  return new Blob([bytes], { type: 'image/webp' })
}

describe('captureVideoFrameToBlob', () => {
  it('videoソース(source.element)のみをdrawImageし、他の一切のソースを描画しない', async () => {
    const { canvas, ctx } = fakeCanvas()
    const createCanvas = vi.fn(() => canvas)
    const canvasToBlob = vi.fn(async () => webpBlob())

    // 「ゴースト画像」に相当するオブジェクトをテスト内で用意するが、
    // captureVideoFrameToBlob の引数としては一切渡さない(渡しようがない関数シグネチャ)。
    const ghostLikeObject = { marker: 'ghost-should-never-be-drawn' }
    const videoLikeSource = { marker: 'video-source' }

    const blob = await captureVideoFrameToBlob(
      { element: videoLikeSource, width: 640, height: 480 },
      { createCanvas, canvasToBlob }
    )

    expect(blob).toBeInstanceOf(Blob)
    expect(canvas.width).toBe(640)
    expect(canvas.height).toBe(480)

    // drawImageはちょうど1回、videoLikeSourceのみを引数に呼ばれる
    expect(ctx.drawImage).toHaveBeenCalledTimes(1)
    expect(ctx.drawImage).toHaveBeenCalledWith(videoLikeSource, 0, 0, 640, 480)

    // ghostLikeObjectがdrawImageのどの呼び出しにも一切現れないことを明示的に確認
    const drawImageMock = ctx.drawImage as ReturnType<typeof vi.fn>
    for (const call of drawImageMock.mock.calls) {
      expect(call).not.toContain(ghostLikeObject)
    }
  })

  it('既定のmimeTypeはimage/webp、qualityは0.8でcanvasToBlobを呼ぶ', async () => {
    const { canvas } = fakeCanvas()
    const canvasToBlob = vi.fn(async () => webpBlob())

    await captureVideoFrameToBlob(
      { element: {}, width: 100, height: 100 },
      { createCanvas: () => canvas, canvasToBlob }
    )

    expect(canvasToBlob).toHaveBeenCalledWith(canvas, 'image/webp', 0.8)
  })

  it('canvasのcontextが取得できない場合はエラーを投げる', async () => {
    const canvas: CaptureCanvas = { width: 0, height: 0, getContext: () => null }
    await expect(
      captureVideoFrameToBlob(
        { element: {}, width: 100, height: 100 },
        { createCanvas: () => canvas, canvasToBlob: vi.fn() }
      )
    ).rejects.toThrow('canvas_context_unavailable')
  })

  // ── 必須修正3: 長辺1920pxへの縮小 ──────────────────────────────────────────

  it('長辺が1920pxを超える場合、canvasサイズが縮小されて描画される(縦横比維持)', async () => {
    const { canvas, ctx } = fakeCanvas()
    const canvasToBlob = vi.fn(async () => webpBlob())

    await captureVideoFrameToBlob(
      { element: {}, width: 3840, height: 2160 }, // 4K相当、長辺3840
      { createCanvas: () => canvas, canvasToBlob }
    )

    expect(canvas.width).toBe(1920)
    expect(canvas.height).toBe(1080)
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1920, 1080)
  })

  it('1920px以下の場合は無駄な拡大をせず元のサイズのまま描画する', async () => {
    const { canvas, ctx } = fakeCanvas()
    const canvasToBlob = vi.fn(async () => webpBlob())

    await captureVideoFrameToBlob(
      { element: {}, width: 800, height: 600 },
      { createCanvas: () => canvas, canvasToBlob }
    )

    expect(canvas.width).toBe(800)
    expect(canvas.height).toBe(600)
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 800, 600)
  })

  // ── 必須修正4: WebPエンコード結果の検証 ──────────────────────────────────────

  it('canvasToBlobがimage/webp以外を返した場合、unsupported_webp_encodingエラーを投げる', async () => {
    const { canvas } = fakeCanvas()
    const canvasToBlob = vi.fn(async () => new Blob(['x'], { type: 'image/png' }))

    await expect(
      captureVideoFrameToBlob(
        { element: {}, width: 100, height: 100 },
        { createCanvas: () => canvas, canvasToBlob }
      )
    ).rejects.toThrow('unsupported_webp_encoding:image/png')
  })

  it('canvasToBlobがBlobを生成できず(呼び出し側実装が)rejectした場合、そのままエラーが伝播する(既存のnull防御)', async () => {
    const { canvas } = fakeCanvas()
    const canvasToBlob = vi.fn(async () => {
      throw new Error('canvas_to_blob_failed')
    })

    await expect(
      captureVideoFrameToBlob(
        { element: {}, width: 100, height: 100 },
        { createCanvas: () => canvas, canvasToBlob }
      )
    ).rejects.toThrow('canvas_to_blob_failed')
  })
})

describe('computeResizedDimensions', () => {
  it('長辺が上限を超える場合、縦横比を維持して縮小する(横長)', () => {
    expect(computeResizedDimensions(3840, 2160, 1920)).toEqual({ width: 1920, height: 1080 })
  })

  it('長辺が上限を超える場合、縦横比を維持して縮小する(縦長)', () => {
    expect(computeResizedDimensions(1000, 2000, 1920)).toEqual({ width: 960, height: 1920 })
  })

  it('長辺が上限以下の場合は元の寸法のまま返す(拡大しない)', () => {
    expect(computeResizedDimensions(800, 600, 1920)).toEqual({ width: 800, height: 600 })
  })

  it('長辺がちょうど上限と同じ場合は縮小しない(境界値)', () => {
    expect(computeResizedDimensions(1920, 1080, 1920)).toEqual({ width: 1920, height: 1080 })
  })

  it('既定の上限はMAX_CAPTURE_LONG_EDGE_PX(1920)', () => {
    expect(computeResizedDimensions(3000, 3000)).toEqual({ width: MAX_CAPTURE_LONG_EDGE_PX, height: MAX_CAPTURE_LONG_EDGE_PX })
  })
})

describe('verifyWebpBlob', () => {
  it('image/webpのBlobはそのまま返す', () => {
    const blob = webpBlob()
    expect(verifyWebpBlob(blob)).toBe(blob)
  })

  it('image/webp以外のBlobはエラーを投げる', () => {
    const blob = new Blob(['x'], { type: 'image/png' })
    expect(() => verifyWebpBlob(blob)).toThrow('unsupported_webp_encoding:image/png')
  })

  it('typeが空文字のBlob(未認識形式)もエラーを投げる', () => {
    const blob = new Blob(['x'])
    expect(() => verifyWebpBlob(blob)).toThrow('unsupported_webp_encoding:unknown')
  })
})
