/**
 * preventAdminStaffLink.ts — ADMIN_EMAIL の auth_uid を brain_staff.user_id へ
 * 登録できないようにするガード（STAFF_MANAGEMENT_PHASE1_IMPLEMENT_1・項目5）。
 *
 * 背景: admin@salon-riora.jp のauth.users.idが、誤って別スタッフ(久保田)の
 * brain_staff.user_idとして流用され、実績データが混線した事故が過去に発生している
 * （docs/auth/AUTH-FIX-DESIGN-1_kubota_user_id.md）。brain_staff.user_idへの書き込みを
 * 行う経路（Phase2のスタッフ新規作成等）は、必ず本関数を先頭で呼ぶこと。
 *
 * Phase1時点ではbrain_staff.user_idへの書き込み経路自体が存在しないため呼び出し元はないが、
 * Phase2で新規作成機能を追加する際に組み込み漏れが起きないよう先行して用意する。
 */
import { createClient } from '@supabase/supabase-js'

const ADMIN_EMAIL = 'admin@salon-riora.jp'

export class AdminStaffLinkError extends Error {}

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase env not configured')
  return createClient(url, key, { auth: { persistSession: false } })
}

/**
 * 指定したauth.users.idがADMIN_EMAILのアカウントである場合、AdminStaffLinkErrorを投げる。
 * brain_staff.user_idへ書き込む直前に必ず呼ぶこと。
 */
export async function assertNotAdminAuthUid(authUid: string): Promise<void> {
  const service = getServiceClient()
  const { data, error } = await service.auth.admin.getUserById(authUid)

  // ユーザー取得自体に失敗した場合はここでは判定不能。呼び出し元の別バリデーション
  // （存在しないauth_uidの拒否等）に委ねるため、ここでは例外を投げない。
  if (error || !data.user) return

  if (data.user.email === ADMIN_EMAIL) {
    throw new AdminStaffLinkError(
      `${ADMIN_EMAIL} のアカウントを brain_staff.user_id として登録することはできません`
    )
  }
}
