/**
 * extractStaffFromRequest.ts — JWT → brain_staff.id 変換
 *
 * Authorization: Bearer <token> ヘッダーを読み、
 * auth.users.id → brain_staff.id (UUID) を返す。
 * 管理者メール (admin@salon-riora.jp) は isAdmin=true を返す。
 * トークンなし/不正/スタッフ未登録は null を返す。
 *
 * admin(owner)はbrain_staffの存在に依存しない: isAdminはemail一致のみで
 * 判定し、brain_staffに行が無くても認証成功として扱う(staffBrainIdはnull)。
 * 一般スタッフはbrain_staffが本人特定の主キーのため、行が無ければ従来どおり401。
 */
import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export interface RequestingStaff {
  authUserId:  string
  staffBrainId: string | null
  email:        string
  isAdmin:      boolean
}

const ADMIN_EMAIL = 'admin@salon-riora.jp'

function getAnonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase env not configured')
  return createClient(url, key, { auth: { persistSession: false } })
}

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase env not configured')
  return createClient(url, key, { auth: { persistSession: false } })
}

export async function extractStaffFromRequest(
  req: NextRequest
): Promise<RequestingStaff | null> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return null

  const token = authHeader.slice(7)
  const anon   = getAnonClient()

  // JWT を検証して auth.users を取得
  const { data: { user }, error } = await anon.auth.getUser(token)
  if (error || !user) return null

  const email   = user.email ?? ''
  const isAdmin = email === ADMIN_EMAIL

  // brain_staff を user_id で引く（service role で確実に取得）
  // maybeSingle: 0件でも例外を投げない(admin はbrain_staff非依存で認証成功させるため)
  const service = getServiceClient()
  const { data: staff } = await service
    .from('brain_staff')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  // 一般スタッフはbrain_staffが本人特定の主キーのため、行が無ければ認証失敗のまま
  if (!staff && !isAdmin) return null

  return {
    authUserId:   user.id,
    staffBrainId: staff?.id ?? null,
    email,
    isAdmin,
  }
}
