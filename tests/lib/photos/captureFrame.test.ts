// ================================================================
// captureFrame.ts — videoフレームのみをcanvasに描画する(ゴーストを焼き込まない)ことの検証
// + 長辺1920pxへの縮小(必須修正3)・WebP→JPEGフォールバック(必須修正4、改訂)
//
// 対応: docs/PHOTO_KARTE_UX_WIREFRAME_1.md 1-4節「保存画像にゴーストを焼き込まない」、
//   実装前レビュー必須修正3・4、iPhone実機テストでのWebP非対応判明後の改訂
//   (canvas.toBlob('image/webp')が非対応環境でimage/png等へ暗黙フォールバックする
//   ことをUA判定ではなく実際のエンコード結果で検知し、image/jpegへフォールバックする)
// ================================================================
import { describe, expect, it, vi } from 'vitest'
import {
  CAPTURE_MIME_FALLBACK_ORDER,
  MAX_CAPTURE_LONG_EDGE_PX,
  captureVideoFrameToBlob,
  computeResizedDimensions,
  encodeCanvasWithFallback,
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

function blobOfType(type: string, bytes: string = 'x'): Blob {
  return new Blob([bytes], { type })
}

describe('captureVideoFrameToBlob', () => {
  it('videoソース(source.element)のみをdrawImageし、他の一切のソースを描画しない', async () => {
    const { canvas, ctx } = fakeCanvas()
    const createCanvas = vi.fn(() => canvas)
    const canvasToBlob = vi.fn(async () => blobOfType('image/webp'))

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

  it('WebPエンコードに成功する環境ではimage/webpのBlobを返す(WebP優先)', async () => {
    const { canvas } = fakeCanvas()
    const canvasToBlob = vi.fn(async (_c, mimeType: string) => blobOfType(mimeType))

    const blob = await captureVideoFrameToBlob(
      { element: {}, width: 100, height: 100 },
      { createCanvas: () => canvas, canvasToBlob }
    )

    expect(blob.type).toBe('image/webp')
    expect(canvasToBlob).toHaveBeenCalledTimes(1)
    expect(canvasToBlob).toHaveBeenCalledWith(canvas, 'image/webp', 0.8)
  })

  it('WebP要求時にimage/png等へ黙ってフォールバックされた場合、image/jpegを再要求して返す(iOS Safari実機相当)', async () => {
    const { canvas } = fakeCanvas()
    const canvasToBlob = vi.fn(async (_c, mimeType: string) => {
      // webpを要求しても常にpngへ黙ってフォールバックする(iOS Safariのcanvas.toBlob挙動を模す)
      if (mimeType === 'image/webp') return blobOfType('image/png')
      return blobOfType(mimeType)
    })

    const blob = await captureVideoFrameToBlob(
      { element: {}, width: 100, height: 100 },
      { createCanvas: () => canvas, canvasToBlob }
    )

    expect(blob.type).toBe('image/jpeg')
    expect(canvasToBlob).toHaveBeenNthCalledWith(1, canvas, 'image/webp', 0.8)
    expect(canvasToBlob).toHaveBeenNthCalledWith(2, canvas, 'image/jpeg', 0.8)
  })

  it('WebP要求がrejectされた場合もJPEGへフォールバックする', async () => {
    const { canvas } = fakeCanvas()
    const canvasToBlob = vi.fn(async (_c, mimeType: string) => {
      if (mimeType === 'image/webp') throw new Error('canvas_to_blob_failed')
      return blobOfType(mimeType)
    })

    const blob = await captureVideoFrameToBlob(
      { element: {}, width: 100, height: 100 },
      { createCanvas: () => canvas, canvasToBlob }
    )

    expect(blob.type).toBe('image/jpeg')
  })

  it('WebP・JPEGいずれも実際の形式で得られない場合はunsupported_image_encodingを投げる', async () => {
    const { canvas } = fakeCanvas()
    const canvasToBlob = vi.fn(async () => blobOfType('image/png')) // 常にpngへフォールバック

    await expect(
      captureVideoFrameToBlob(
        { element: {}, width: 100, height: 100 },
        { createCanvas: () => canvas, canvasToBlob }
      )
    ).rejects.toThrow('unsupported_image_encoding')
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
    const canvasToBlob = vi.fn(async (_c, mimeType: string) => blobOfType(mimeType))

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
    const canvasToBlob = vi.fn(async (_c, mimeType: string) => blobOfType(mimeType))

    await captureVideoFrameToBlob(
      { element: {}, width: 800, height: 600 },
      { createCanvas: () => canvas, canvasToBlob }
    )

    expect(canvas.width).toBe(800)
    expect(canvas.height).toBe(600)
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 800, 600)
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

describe('encodeCanvasWithFallback', () => {
  it('CAPTURE_MIME_FALLBACK_ORDERはimage/webp→image/jpegの順', () => {
    expect(CAPTURE_MIME_FALLBACK_ORDER).toEqual(['image/webp', 'image/jpeg'])
  })

  it('1番目(webp)で実際に要求どおりのtypeが得られればそれ以上試さない', async () => {
    const { canvas } = fakeCanvas()
    const canvasToBlob = vi.fn(async (_c, mimeType: string) => blobOfType(mimeType))

    const blob = await encodeCanvasWithFallback(canvas, canvasToBlob)

    expect(blob.type).toBe('image/webp')
    expect(canvasToBlob).toHaveBeenCalledTimes(1)
  })

  it('quality引数を各候補の呼び出しに渡す', async () => {
    const { canvas } = fakeCanvas()
    const canvasToBlob = vi.fn(async (_c, mimeType: string) => blobOfType(mimeType))

    await encodeCanvasWithFallback(canvas, canvasToBlob, 0.5)

    expect(canvasToBlob).toHaveBeenCalledWith(canvas, 'image/webp', 0.5)
  })
})
