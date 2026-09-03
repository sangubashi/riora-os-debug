// ================================================================
// captureConfirmFlow.ts — シャッター後のローカル確定フロー(R1)の単体テスト
//
// 対応: docs/PHOTO_KARTE_UX_WIREFRAME_1.md 1-8-1節
//   - シャッター直後にはPOSTしない
//   - 1.5秒後に初めてclientRequestIdを生成してPOSTする
//   - 1.5秒以内に「撮り直す」を押した場合はPOSTしない
// ================================================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CAPTURE_AUTO_CONFIRM_MS,
  CaptureConfirmSession,
  type UploadPhotoFn,
} from '../../../src/lib/photos/captureConfirmFlow'

function makePayload(overrides: Partial<{ bodyPart: string; photoType: 'before' | 'after' | 'progress'; visitId: string | null }> = {}) {
  return {
    blob: new Blob(['fake'], { type: 'image/webp' }),
    bodyPart: 'face_front',
    photoType: 'before' as const,
    visitId: 'visit-1',
    ...overrides,
  }
}

describe('CaptureConfirmSession', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('シャッター直後(capture呼び出し時点)ではuploadPhotoを呼ばない', () => {
    const uploadPhoto = vi.fn<UploadPhotoFn>(async () => {})
    const session = new CaptureConfirmSession({
      setTimer: (cb, ms) => setTimeout(cb, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      generateClientRequestId: () => 'req-1',
      uploadPhoto,
    })

    session.capture(makePayload())

    expect(uploadPhoto).not.toHaveBeenCalled()
    expect(session.getPhase()).toBe('reviewing')
  })

  it('1.5秒(既定値)経過後に初めてuploadPhotoがclientRequestId付きで呼ばれる', async () => {
    const uploadPhoto = vi.fn<UploadPhotoFn>(async () => {})
    const generateClientRequestId = vi.fn(() => 'req-generated')
    const session = new CaptureConfirmSession({
      setTimer: (cb, ms) => setTimeout(cb, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      generateClientRequestId,
      uploadPhoto,
    })

    session.capture(makePayload({ bodyPart: 'cheek_left', photoType: 'after' }))

    // 1.5秒未満ではまだ呼ばれない
    await vi.advanceTimersByTimeAsync(CAPTURE_AUTO_CONFIRM_MS - 1)
    expect(uploadPhoto).not.toHaveBeenCalled()
    expect(generateClientRequestId).not.toHaveBeenCalled()

    // 1.5秒経過で自動確定
    await vi.advanceTimersByTimeAsync(1)
    expect(generateClientRequestId).toHaveBeenCalledTimes(1)
    expect(uploadPhoto).toHaveBeenCalledTimes(1)
    expect(uploadPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ bodyPart: 'cheek_left', photoType: 'after', clientRequestId: 'req-generated' })
    )
    expect(session.getPhase()).toBe('confirmed')
  })

  it('1.5秒以内に retake() を呼ぶとuploadPhotoは一切呼ばれない', async () => {
    const uploadPhoto = vi.fn<UploadPhotoFn>(async () => {})
    const clearTimer = vi.fn((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>))
    const session = new CaptureConfirmSession({
      setTimer: (cb, ms) => setTimeout(cb, ms),
      clearTimer,
      generateClientRequestId: () => 'req-1',
      uploadPhoto,
    })

    session.capture(makePayload())
    await vi.advanceTimersByTimeAsync(500) // 1.5秒より前に撮り直す
    session.retake()

    expect(clearTimer).toHaveBeenCalledTimes(1)
    expect(session.getPhase()).toBe('discarded')

    // タイマーが本来発火するはずだった時刻を過ぎてもuploadPhotoは呼ばれない
    await vi.advanceTimersByTimeAsync(CAPTURE_AUTO_CONFIRM_MS)
    expect(uploadPhoto).not.toHaveBeenCalled()
  })

  it('retake後に同じセッションで再度capture()すると通常通り撮影を受け付ける', async () => {
    const uploadPhoto = vi.fn<UploadPhotoFn>(async () => {})
    const generateClientRequestId = vi.fn(() => 'req-2')
    const session = new CaptureConfirmSession({
      setTimer: (cb, ms) => setTimeout(cb, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      generateClientRequestId,
      uploadPhoto,
    })

    session.capture(makePayload())
    session.retake()

    session.capture(makePayload({ bodyPart: 'nose' }))
    await vi.advanceTimersByTimeAsync(CAPTURE_AUTO_CONFIRM_MS)

    expect(uploadPhoto).toHaveBeenCalledTimes(1)
    expect(uploadPhoto).toHaveBeenCalledWith(expect.objectContaining({ bodyPart: 'nose' }))
  })

  it('レビュー中の二重capture()は無視される(タイマーが再起動しない)', async () => {
    const uploadPhoto = vi.fn<UploadPhotoFn>(async () => {})
    const session = new CaptureConfirmSession({
      setTimer: (cb, ms) => setTimeout(cb, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      generateClientRequestId: () => 'req-1',
      uploadPhoto,
    })

    session.capture(makePayload({ bodyPart: 'chin' }))
    await vi.advanceTimersByTimeAsync(1000)
    session.capture(makePayload({ bodyPart: 'neck' })) // reviewing中なので無視されるはず

    await vi.advanceTimersByTimeAsync(500) // 最初のタイマー(残り500ms)が発火する
    expect(uploadPhoto).toHaveBeenCalledTimes(1)
    expect(uploadPhoto).toHaveBeenCalledWith(expect.objectContaining({ bodyPart: 'chin' }))
  })

  it('unmount相当(retake()呼び出し)で1.5秒より前にタイマーがキャンセルされればuploadPhotoは呼ばれない', async () => {
    // usePhotoCapture.tsのunmountクリーンアップは sessionRef.current?.retake() を呼ぶ
    // (実装前レビュー必須修正1)。ここではその呼び出しを模して、画面を閉じる操作が
    // 「撮り直す」と同じ結果になることを確認する。
    const uploadPhoto = vi.fn<UploadPhotoFn>(async () => {})
    const session = new CaptureConfirmSession({
      setTimer: (cb, ms) => setTimeout(cb, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      generateClientRequestId: () => 'req-unmount',
      uploadPhoto,
    })

    session.capture(makePayload())
    await vi.advanceTimersByTimeAsync(1000) // レビュー中(1.5秒未満)にunmount相当が発生

    session.retake() // usePhotoCaptureのunmountクリーンアップと同じ呼び出し

    await vi.advanceTimersByTimeAsync(CAPTURE_AUTO_CONFIRM_MS)
    expect(uploadPhoto).not.toHaveBeenCalled()
    expect(session.getPhase()).toBe('discarded')
  })

  it('stale callback対策: clearTimerが実質的に効かない環境でも、discarded後のphaseガードによりuploadPhotoは呼ばれない', async () => {
    // clearTimerをno-opにして「タイマーのキャンセルが何らかの理由で効かなかった」状況を
    // 意図的に再現し、それでもphaseガード('reviewing'以外では自動確定しない)が
    // 最終防波堤として機能することを確認する。
    const uploadPhoto = vi.fn<UploadPhotoFn>(async () => {})
    const session = new CaptureConfirmSession({
      setTimer: (cb, ms) => setTimeout(cb, ms),
      clearTimer: () => {}, // 意図的に無効化(stale callbackを模す)
      generateClientRequestId: () => 'req-stale',
      uploadPhoto,
    })

    session.capture(makePayload())
    await vi.advanceTimersByTimeAsync(1000)
    session.retake() // phase='discarded'になるが、内部タイマーは(clearTimerが無効なため)残り続ける

    // 元のタイマーがそのまま発火する時刻を過ぎても、autoConfirm内のphaseガードにより
    // uploadPhotoは呼ばれない
    await vi.advanceTimersByTimeAsync(CAPTURE_AUTO_CONFIRM_MS)
    expect(uploadPhoto).not.toHaveBeenCalled()
  })

  it('retake()はreviewing状態以外では何もしない(idle状態での誤呼び出し)', () => {
    const clearTimer = vi.fn()
    const session = new CaptureConfirmSession({
      setTimer: (cb, ms) => setTimeout(cb, ms),
      clearTimer,
      generateClientRequestId: () => 'req-1',
      uploadPhoto: vi.fn(async () => {}),
    })

    session.retake()
    expect(clearTimer).not.toHaveBeenCalled()
    expect(session.getPhase()).toBe('idle')
  })
})
