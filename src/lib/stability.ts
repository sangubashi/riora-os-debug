/**
 * stability.ts  — PHASE 7
 * "止まらない・壊れない" のための安定性レイヤー。
 *
 * 使い方:
 *   const data = await withRetry(() => supabase.from('...').select(), { maxAttempts: 3 })
 *   const data = await withTimeout(() => fetch(...), 5000)
 *   const data = await withFallback(() => fetchReal(), fallbackValue)
 */

// ─── retry ────────────────────────────────────────────────────────────────────

export interface RetryOptions {
  maxAttempts?: number    // デフォルト: 3
  delayMs?:     number    // デフォルト: 400ms
  backoff?:     boolean   // 指数バックオフ（デフォルト: true）
  onRetry?:     (attempt: number, error: unknown) => void
}

export async function withRetry<T>(
  fn:   () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const { maxAttempts = 3, delayMs = 400, backoff = true, onRetry } = opts
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (e) {
      lastError = e
      if (attempt === maxAttempts) break
      onRetry?.(attempt, e)
      const wait = backoff ? delayMs * Math.pow(2, attempt - 1) : delayMs
      await sleep(wait)
    }
  }

  throw lastError
}

// ─── timeout ─────────────────────────────────────────────────────────────────

export async function withTimeout<T>(
  fn:        () => Promise<T>,
  timeoutMs: number,
  label?:    string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`[timeout] ${label ?? 'operation'} exceeded ${timeoutMs}ms`))
    }, timeoutMs)
  })

  try {
    const result = await Promise.race([fn(), timeoutPromise])
    return result
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}

// ─── fallback ─────────────────────────────────────────────────────────────────

/**
 * 失敗時に fallbackValue を返す。エラーはログのみ。
 * UI を止めない用途（非重要な AI 分析など）に使用。
 */
export async function withFallback<T>(
  fn:            () => Promise<T>,
  fallbackValue: T,
  label?:        string
): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    prodLog('warn', `[fallback] ${label ?? 'operation'} failed, using fallback`, e)
    return fallbackValue
  }
}

// ─── stable Supabase 呼び出し（retry + timeout + fallback を合成） ────────────

export async function stableQuery<T>(
  fn:            () => Promise<T>,
  fallbackValue: T,
  opts: {
    label?:       string
    timeoutMs?:   number
    maxAttempts?: number
  } = {}
): Promise<T> {
  const { label = 'query', timeoutMs = 8000, maxAttempts = 2 } = opts
  return withFallback(
    () => withTimeout(
      () => withRetry(fn, { maxAttempts, delayMs: 500, onRetry: (n) => {
        prodLog('warn', `[retry] ${label} attempt ${n}`)
      }}),
      timeoutMs,
      label
    ),
    fallbackValue,
    label
  )
}

// ─── mutex（連打・多重実行防止） ──────────────────────────────────────────────

export class Mutex {
  private locked = false
  private queue: Array<() => void> = []

  async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true
      return this.release.bind(this)
    }
    return new Promise(resolve => {
      this.queue.push(() => {
        this.locked = true
        resolve(this.release.bind(this))
      })
    })
  }

  private release() {
    const next = this.queue.shift()
    if (next) {
      next()
    } else {
      this.locked = false
    }
  }

  /** 既に locked なら即 false を返す（連打防止用） */
  tryAcquire(): (() => void) | null {
    if (this.locked) return null
    this.locked = true
    return this.release.bind(this)
  }
}

// ─── debounce ─────────────────────────────────────────────────────────────────

export function debounce<T extends unknown[]>(
  fn:    (...args: T) => void,
  waitMs: number
): (...args: T) => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  return (...args: T) => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => { fn(...args); timer = null }, waitMs)
  }
}

// ─── Production Logging ───────────────────────────────────────────────────────

export type LogLevel = 'info' | 'warn' | 'error' | 'slow'

interface LogEntry {
  level:     LogLevel
  message:   string
  detail?:   unknown
  timestamp: string
}

/** メモリ内ログバッファ（最大 200 件、ローリング） */
const LOG_BUFFER: LogEntry[] = []
const LOG_MAX    = 200

export function prodLog(level: LogLevel, message: string, detail?: unknown): void {
  const entry: LogEntry = { level, message, detail, timestamp: new Date().toISOString() }

  // console に出力（dev はすべて、prod は warn/error のみ）
  if (process.env.NODE_ENV === 'development' || level === 'warn' || level === 'error' || level === 'slow') {
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
    fn(`[Riora][${level.toUpperCase()}]`, message, detail ?? '')
  }

  LOG_BUFFER.push(entry)
  if (LOG_BUFFER.length > LOG_MAX) LOG_BUFFER.splice(0, LOG_BUFFER.length - LOG_MAX)
}

/** ログバッファ取得（デバッグ・monitoring 用） */
export function getLogBuffer(): Readonly<LogEntry[]> {
  return LOG_BUFFER
}

/** スロークエリ計測ラッパー（500ms 超で warn ログ） */
export async function measureQuery<T>(
  fn:     () => Promise<T>,
  label:  string,
  warnMs = 500
): Promise<T> {
  const start  = performance.now()
  const result = await fn()
  const elapsed = performance.now() - start
  if (elapsed > warnMs) {
    prodLog('slow', `[slow] ${label} took ${elapsed.toFixed(0)}ms`)
  }
  return result
}

// ─── ヘルパー ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
