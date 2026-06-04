/**
 * voiceQueue.ts  — PHASE 10.3 / STEP 2
 *
 * Voice Queue System
 * 録音連打・多重解析を防止し、接客テンポを壊さない。
 *
 * 設計:
 *   - FIFO キュー
 *   - 処理中は新リクエストをキュー or stale 破棄
 *   - キャンセル時は次のアイテムを即処理
 *   - リクエスト TTL（デフォルト 30秒）を超えたら stale として破棄
 */

import { prodLog } from '@/lib/stability'
import {
  runStreamPipeline,
  StreamPipelineController,
  type StreamPipelineCallbacks,
  type StreamPipelineOptions,
  type StreamPipelineResult,
} from '@/lib/voice/streamPipeline'

// ─── 型 ──────────────────────────────────────────────────────────────────────

interface QueueItem {
  id:          string
  audioBlob:   Blob
  durationSec: number
  callbacks:   StreamPipelineCallbacks
  options:     StreamPipelineOptions
  controller:  StreamPipelineController
  enqueuedAt:  number   // Date.now()
  resolve:     (result: StreamPipelineResult) => void
  reject:      (err: unknown) => void
}

// ─── Voice Queue ──────────────────────────────────────────────────────────────

export class VoiceQueue {
  private queue:      QueueItem[]               = []
  private processing: QueueItem | null          = null
  private staleTtlMs: number

  constructor(staleTtlMs = 30_000) {
    this.staleTtlMs = staleTtlMs
  }

  // ── キューに追加 ────────────────────────────────────────────────────────────

  enqueue(
    audioBlob:   Blob,
    durationSec: number,
    callbacks:   StreamPipelineCallbacks,
    options:     StreamPipelineOptions = {}
  ): { id: string; promise: Promise<StreamPipelineResult>; controller: StreamPipelineController } {
    const id         = `vq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const controller = new StreamPipelineController()

    const promise = new Promise<StreamPipelineResult>((resolve, reject) => {
      this.queue.push({
        id, audioBlob, durationSec, callbacks, options, controller,
        enqueuedAt: Date.now(),
        resolve, reject,
      })
      prodLog('info', `[VoiceQueue] enqueue id=${id} queueLen=${this.queue.length}`)
    })

    this.processNext()
    return { id, promise, controller }
  }

  // ── キャンセル ──────────────────────────────────────────────────────────────

  cancel(id: string): void {
    // 処理中のアイテムをキャンセル
    if (this.processing?.id === id) {
      this.processing.controller.cancel()
      prodLog('info', `[VoiceQueue] cancel processing id=${id}`)
      return
    }
    // キュー内から除去
    const idx = this.queue.findIndex(item => item.id === id)
    if (idx !== -1) {
      const item = this.queue.splice(idx, 1)[0]
      item.controller.cancel()
      item.reject(new Error('cancelled'))
      prodLog('info', `[VoiceQueue] cancel queued id=${id}`)
    }
  }

  // ── 全クリア ────────────────────────────────────────────────────────────────

  cancelAll(): void {
    this.processing?.controller.cancel()
    this.queue.forEach(item => {
      item.controller.cancel()
      item.reject(new Error('cancelled'))
    })
    this.queue = []
    prodLog('info', '[VoiceQueue] cancelAll')
  }

  get size(): number  { return this.queue.length }
  get busy(): boolean { return this.processing !== null }

  // ── 内部: 次のアイテムを処理 ────────────────────────────────────────────────

  private processNext(): void {
    if (this.processing !== null) return  // 処理中は待機

    // stale なアイテムを先頭から捨てる
    while (this.queue.length > 0) {
      const head = this.queue[0]
      if (Date.now() - head.enqueuedAt > this.staleTtlMs) {
        this.queue.shift()
        head.controller.cancel()
        head.reject(new Error('stale'))
        prodLog('warn', `[VoiceQueue] stale discard id=${head.id}`)
      } else {
        break
      }
    }

    if (this.queue.length === 0) return

    const item      = this.queue.shift()!
    this.processing = item

    prodLog('info', `[VoiceQueue] start processing id=${item.id}`)

    runStreamPipeline(
      { audioBlob: item.audioBlob, durationSec: item.durationSec },
      item.callbacks,
      item.options,
      item.controller
    )
      .then(result => {
        item.resolve(result)
        prodLog('info', `[VoiceQueue] done id=${item.id}`)
      })
      .catch(err => {
        item.reject(err)
        prodLog('warn', `[VoiceQueue] error id=${item.id}`, err)
      })
      .finally(() => {
        this.processing = null
        // キャンセルされていても次を処理する
        this.processNext()
      })
  }
}

// ─── シングルトン（アプリ全体で共有） ────────────────────────────────────────

let _instance: VoiceQueue | null = null

export function getVoiceQueue(): VoiceQueue {
  if (!_instance) _instance = new VoiceQueue()
  return _instance
}

export function resetVoiceQueue(): void {
  _instance?.cancelAll()
  _instance = null
}
