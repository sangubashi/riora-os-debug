/**
 * authSession.ts — E2Eテスト用の認証ヘルパー
 *
 * ブラウザUIのログインフォームは実パスワードが必要なため、Supabase Admin API
 * (service_role)でmagiclinkを発行 → サーバー側でリダイレクト先のトークンを取得 →
 * supabase-jsのsetSession()で正規のセッションオブジェクトを得る。
 * テスト側はbuildAuthedSession()の戻り値をpage.addInitScript()でlocalStorageへ
 * 注入することで、実際のログインフォーム操作を行わずに認証済み状態を再現できる。
 *
 * 注意: 同じadmin@salon-riora.jpに対してmagiclinkを短時間に複数発行すると競合して
 * 失敗することがある。このヘルパーを使うspecファイルを複数同時実行する場合は
 * `playwright test --workers=1` で直列実行すること。
 */
import { createClient, type Session } from '@supabase/supabase-js'

const SB_URL = 'https://ohszxgajckzphhfhdrsv.supabase.co'
export const SUPABASE_PROJECT_REF = 'ohszxgajckzphhfhdrsv'
const ADMIN_EMAIL = 'admin@salon-riora.jp'

export async function buildAuthedSession(): Promise<Session> {
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!svcKey || !anonKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY is required')
  }

  const genRes = await fetch(`${SB_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email: ADMIN_EMAIL }),
  })
  const genData = (await genRes.json()) as { action_link: string }
  const verifyRes = await fetch(genData.action_link, { redirect: 'manual' })
  const location = verifyRes.headers.get('location') ?? ''
  const hash = location.split('#')[1] ?? ''
  const params = new URLSearchParams(hash)
  const access_token = params.get('access_token')!
  const refresh_token = params.get('refresh_token')!

  const supabase = createClient(SB_URL, anonKey, { auth: { persistSession: false } })
  const { data, error } = await supabase.auth.setSession({ access_token, refresh_token })
  if (error || !data.session) throw new Error(`setSession failed: ${error?.message}`)
  return data.session
}
