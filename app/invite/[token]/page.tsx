/**
 * app/invite/[token]/page.tsx — スタッフ招待の初回登録画面(STAFF_MANAGEMENT_PHASE2_2)
 *
 * 認証不要(招待トークン自体が認可)。paramsはNext.js 16のApp Routerの慣例通り
 * Promiseで受け取り、tokenをクライアントコンポーネントへpropsで渡すだけの
 * サーバーコンポーネント(実処理はInvitePageClient側)。
 */
import InvitePageClient from './InvitePageClient'

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  return <InvitePageClient token={token} />
}
