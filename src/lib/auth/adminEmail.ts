/**
 * adminEmail.ts — 管理者アカウントの判定を1か所に集約する(ADMIN_LOGIN_REDIRECT_FIX)。
 *
 * クライアント側の「管理者ならどこへ遷移させるか」判定(ログイン画面・
 * AdminAuthGuard)はこの1ファイルのみを参照する。
 *
 * 【重要】src/lib/auth/extractStaffFromRequest.ts(サーバー側API認証)と
 * src/lib/auth/preventAdminStaffLink.ts(スタッフ招待時のガード)にも同じ
 * ADMIN_EMAIL定数が別途存在するが、これらはAPIルート全般・スタッフ管理機能に
 * 広く使われており、今回のスコープ(管理者ログイン導線のみ)を超えるため
 * 意図的に手を加えていない。
 */
export const ADMIN_EMAIL = 'admin@salon-riora.jp'

export function isAdminEmail(email: string | null | undefined): boolean {
  return email === ADMIN_EMAIL
}
