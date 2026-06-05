/**
 * GET  /api/line/webhook — LINE Webhook 疎通確認用（200を返すだけ）
 * POST /api/line/webhook — LINE からのイベントを受信してログ出力
 *
 * 目的: LINE_TEST_USER_ID の取得。署名検証は未実装。
 */

export async function GET() {
  return new Response('OK', { status: 200 })
}

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new Response('Bad Request', { status: 400 })
  }

  console.log('[LINE webhook] raw body:', JSON.stringify(body, null, 2))

  // events 配列を走査してユーザー情報をログ出力
  const events = (body as any)?.events ?? []
  for (const event of events) {
    console.log('[LINE webhook] source.type  :', event?.source?.type)
    console.log('[LINE webhook] source.userId:', event?.source?.userId)
    console.log('[LINE webhook] message.text :', event?.message?.text)
  }

  // LINE は 200 が返らないと再送してくるので必ず 200
  return new Response('OK', { status: 200 })
}
