/**
 * rateLimit.ts — 用途別Rate Limiter(STAFF-PERMISSION-AUDIT-2 STEP3)
 *
 * 目的: API回数そのものの制限ではなく、外部API費用(Claude/Whisper)の暴走防止と
 * LINE二重送信事故の防止。Vercelはリクエストごとに別インスタンスの可能性があり
 * メモリ内カウンタは信頼できないため、Upstash Redis(Vercel Marketplace経由で
 * プロビジョニング済み・KV_REST_API_URL/KV_REST_API_TOKEN)を共有ストアに使う。
 *
 * 各APIルートでの使い方: 認証成功直後(canAccessCustomer等の前)に呼ぶこと。
 * 未認証リクエストはlimiterに触れないため、Redisコマンドを消費しない。
 *
 *   const { success } = await claudeLimiter.limit(staff.authUserId)
 *   if (!success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
 */
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

const redis = Redis.fromEnv()

/**
 * LINE実送信の二重送信防止(line/approve、action==='approve'時のみ使用)。
 * キーは送信先(line_user_id)単位。同一顧客への連続承認を30秒に1回までに制限する
 * (スタッフの二度押し・ネットワーク再送による重複送信を防ぐことが目的で、
 * 正当な連続業務利用を妨げる意図はないため上限回数ではなく短い窓のみ設定する)。
 */
export const lineSendDuplicateLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(1, '30 s'),
  prefix:  'ratelimit:line-send',
  analytics: false,
})

/** LINEテスト送信(line/test-send、管理者限定)。連打防止程度の緩い上限。 */
export const lineTestSendLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, '1 m'),
  prefix:  'ratelimit:line-test-send',
  analytics: false,
})

/**
 * Claude呼び出し系(homecare-message/line-message/timeline-summary/
 * conversation-starters)。スタッフ単位。通常業務(複数顧客への連続生成等)を
 * 妨げない緩い上限とし、スクリプト連打・暴走のみを弾く。
 */
export const claudeLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, '1 m'),
  prefix:  'ratelimit:claude',
  analytics: false,
})

/**
 * voice-pipeline(Whisper+Claude、1回で外部API2種を叩く最重量エンドポイント)。
 * スタッフ単位。録音1件ごとに1回実行される処理のため、通常業務では十分な余裕。
 */
export const voicePipelineLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, '1 m'),
  prefix:  'ratelimit:voice-pipeline',
  analytics: false,
})
