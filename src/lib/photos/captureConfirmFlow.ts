/**
 * captureConfirmFlow.ts — シャッター後の「ローカル確定フロー」オーケストレーション(R1仕様)
 *
 * 設計根拠: docs/PHOTO_KARTE_UX_WIREFRAME_1.md 1-8節・1-8-1節。
 *
 *   シャッター → ローカルBlob保持のみ(POSTしない) → フリーズ表示+1.5秒待機
 *   → 自動確定(このタイミングで初めてclientRequestIdを生成しPOST)
 *   → 1.5秒以内に「撮り直す」が押された場合はPOSTせずローカルBlobを破棄
 *
 * src/lib/voice/voiceMemoFlow.ts と同じ「Reactに依存しない純粋なオーケストレーション」
 * 方針で実装する。タイマー・ID生成・アップロード関数はすべて依存注入し、
 * vi.useFakeTimers() 等で確定的にテストできるようにする。
 */

export const CAPTURE_AUTO_CONFIRM_MS = 1500 // Phase1暫定値。実機検証で調整可能(1-8-1節)。

export type CapturePhotoType = 'before' | 'after' | 'progress'

export interface CapturedPhotoPayload {
  blob:      Blob
  bodyPart:  string
  photoType: CapturePhotoType
  visitId:   string | null
}

/** clientRequestIdは自動確定のタイミングで初めて付与される(撮り直し時は一切生成されない)。 */
export type UploadPhotoFn = (
  payload: CapturedPhotoPayload & { clientRequestId: string }
) => Promise<void>

export interface CaptureConfirmDeps {
  setTimer:                 (cb: () => void, ms: number) => unknown
  clearTimer:               (handle: unknown) => void
  generateClientRequestId:  () => string
  uploadPhoto:               UploadPhotoFn
  autoConfirmMs?:            number
}

export type CaptureConfirmPhase = 'idle' | 'reviewing' | 'confirmed' | 'discarded'

/**
 * 1回の撮影(シャッター〜自動確定/撮り直し)を管理するセッション。
 * 確定後・撮り直し後も同じインスタンスを使い回して次のシャッターを受け付けてよい
 * (capture()は 'reviewing' 中の二重シャッターだけをガードする)。
 */
export class CaptureConfirmSession {
  private phase: CaptureConfirmPhase = 'idle'
  private timerHandle: unknown = null
  private payload: CapturedPhotoPayload | null = null
  private readonly deps: CaptureConfirmDeps & { autoConfirmMs: number }

  constructor(deps: CaptureConfirmDeps) {
    this.deps = { autoConfirmMs: CAPTURE_AUTO_CONFIRM_MS, ...deps }
  }

  getPhase(): CaptureConfirmPhase {
    return this.phase
  }

  /** シャッター押下。ローカルBlobを保持するのみで、この時点ではPOSTを一切呼ばない。 */
  capture(payload: CapturedPhotoPayload): void {
    if (this.phase === 'reviewing') return // レビュー中の二重シャッターを防止

    this.payload = payload
    this.phase = 'reviewing'
    this.timerHandle = this.deps.setTimer(() => {
      void this.autoConfirm()
    }, this.deps.autoConfirmMs)
  }

  /**
   * 1.5秒経過時に自動的に呼ばれる。ここで初めて clientRequestId を生成し POST する。
   * 画面遷移はこの関数の呼び出し(=タイマー発火)と同時に行われる想定であり、
   * uploadPhoto の完了(ネットワーク応答)を待たずに次の状態へ進んでよい
   * (呼び出し側=Reactフックがこの点を担保する)。
   */
  private async autoConfirm(): Promise<void> {
    if (this.phase !== 'reviewing' || !this.payload) return
    const payload = this.payload
    this.phase = 'confirmed'
    this.payload = null
    this.timerHandle = null

    const clientRequestId = this.deps.generateClientRequestId()
    await this.deps.uploadPhoto({ ...payload, clientRequestId })
  }

  /**
   * 「撮り直す」。POSTは一切呼ばない(サーバー側には何も存在しないため、
   * DELETE APIを呼ぶ必要はない、docs/PHOTO_KARTE_UX_WIREFRAME_1.md 1-8-1節3b)。
   */
  retake(): void {
    if (this.phase !== 'reviewing') return
    if (this.timerHandle !== null) this.deps.clearTimer(this.timerHandle)
    this.timerHandle = null
    this.payload = null
    this.phase = 'discarded'
  }
}
