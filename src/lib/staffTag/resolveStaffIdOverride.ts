/**
 * resolveStaffIdOverride.ts — 担当者タグ上書きの検証・解決(サーバー専用、
 * PHASE IPAD-SHARED-LOGIN-1・2026-09-20ユーザー承認)。
 *
 * 店舗共通ログイン(SHARED_IPAD_STAFF_USER_ID)からのリクエストに限り、クライアントが
 * 指定したstaffId(brain_staff.id)を書き込みの担当者として許可する。個人ログイン時は
 * requestedStaffIdが送られてきても常に無視してnullを返す(なりすまし防止。
 * 呼び出し元はnullの場合、従来通りJWTから解決した本人の識別子を使うこと)。
 *
 * brain_customer_photos.created_by はbrain_staff.idを直接使うが、customer_karte_memos
 * .staff_id はauth.users.id(brain_staff.user_id)を使う既存スキーマの違いを吸収するため、
 * 両方を返す(呼び出し元は自分のテーブルに合う方を選ぶ)。
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { SHARED_IPAD_STAFF_USER_ID } from '@/lib/constants'
import type { RequestingStaff } from '@/lib/auth/extractStaffFromRequest'

export interface ResolvedStaffOverride {
  /** brain_staff.id。photosのcreated_by等、brain_staff.idを直接参照する列向け。 */
  staffBrainId: string
  /** brain_staff.user_id (auth.users.id)。customer_karte_memos.staff_id向け。 */
  authUserId: string
}

export async function resolveStaffIdOverride(
  supabase: SupabaseClient,
  requester: RequestingStaff,
  requestedStaffId: string | undefined | null
): Promise<ResolvedStaffOverride | null> {
  if (!requestedStaffId) return null
  if (requester.authUserId !== SHARED_IPAD_STAFF_USER_ID) return null

  const { data } = await supabase
    .from('brain_staff')
    .select('id, user_id')
    .eq('id', requestedStaffId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle()

  if (!data || !data.user_id) return null
  return { staffBrainId: data.id as string, authUserId: data.user_id as string }
}
