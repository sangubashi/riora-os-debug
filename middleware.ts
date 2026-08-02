import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * STAFF_APP_PRODUCTION_FIX_PASS_2 P2/P3
 *
 * /test・/phase1-debugは開発用の診断・オフライン検証ページ(Supabase接続情報表示・
 * LINE実送信テスト・ダミーデータ全機能検証を含む)。本番(NODE_ENV !== 'development')
 * では認証ガードも無いため、リクエストの時点でHTTP 404を返し到達不可にする。
 *
 * ページ側のnotFound()呼び出しだけでは、Client Componentを描画するServer Component
 * ページ(/phase1-debug)でビルド時の静的prerenderにHTTPステータス404が反映されない
 * ケースが確認されたため、middlewareでリクエストレベルに確実にガードする。
 */
const BLOCKED_IN_PRODUCTION = new Set(['/test', '/phase1-debug'])

export function middleware(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development' && BLOCKED_IN_PRODUCTION.has(request.nextUrl.pathname)) {
    return new NextResponse(null, { status: 404 })
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/test', '/phase1-debug'],
}
