/**
 * inviteLink.ts — スタッフ招待URLの生成方式(STAFF_MANAGEMENT_PHASE2_1/2_2)。
 *
 * パス形式について: Phase2-1時点ではdocs/STAFF_MANAGEMENT_PHASE2_DESIGN_2.md
 * 7章・9章の`/staff-signup?token=...`(クエリパラメータ)に統一する方針だったが、
 * STAFF_MANAGEMENT_PHASE2_2_IMPLEMENT_1で`/invite/{token}`(パスパラメータ)を
 * 明示的に指示されたため、本ファイルはその指示を優先しこちらへ変更した
 * (`app/invite/[token]/page.tsx`が対応する画面)。
 *
 * サーバー専用(Node.jsの`crypto`を使用)。クライアントコンポーネントからは
 * importしないこと(招待発行API `POST /api/admin/staff/invite` から使用する)。
 */
import { randomBytes } from 'crypto'

/** 招待トークンを生成する(URL安全なbase64url、32byte=256bit相当のランダム値)。 */
export function generateInviteToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * 招待トークンから招待URL(絶対URL)を組み立てる。`/invite/{token}`形式
 * (STAFF_MANAGEMENT_PHASE2_2で指定)。
 * @param origin `req.nextUrl.origin`等、呼び出し元のオリジン(スキーム+ホスト)。
 */
export function buildInviteUrl(token: string, origin: string): string {
  return `${origin}/invite/${encodeURIComponent(token)}`
}
