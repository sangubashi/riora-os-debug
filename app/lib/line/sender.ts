/**
 * sender.ts — LINE メッセージ送信の抽象層
 *
 * 設計:
 *   - ENV をモジュールロード時ではなく呼び出し時に検証（missing ENVでもビルド可能）
 *   - throw ではなく Result 型で返す（API route でハンドリングしやすい）
 *   - message_body を引数に受け取るため、将来 AI 生成文に差し替えるだけでよい
 */

export type SendResult =
  | { ok: true }
  | { ok: false; error: string }

/**
 * 指定 LINE user ID にプッシュ送信する。
 * 将来 AI 生成文を渡す場合は messageBody を差し替えるだけでよい。
 */
export async function sendLineMessage(
  recipientId: string,
  messageBody: string,
): Promise<SendResult> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN
  if (!token) {
    return { ok: false, error: 'ENV missing: LINE_CHANNEL_ACCESS_TOKEN が設定されていません' }
  }

  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        to:       recipientId,
        messages: [{ type: 'text', text: messageBody }],
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      return { ok: false, error: `LINE API ${res.status}: ${body}` }
    }

    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}
