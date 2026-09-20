/**
 * GET /api/staff/active-list — 担当者タグ選択用のスタッフ一覧(PHASE IPAD-SHARED-LOGIN-1・
 * 2026-09-20ユーザー承認)
 *
 * iPad店舗共通ログインで開く「担当者タグ選択」プロンプトの候補一覧を返す。管理者専用の
 * /api/admin/staff とは異なり、有効な認証済みスタッフであれば誰でも呼べる(admin不要)。
 * store_id=DEMO_STORE_ID・is_active=true・deleted_at is nullの`brain_staff`のうち、
 * 店舗共通ログインアカウント自身(SHARED_IPAD_STAFF_USER_ID)、および現場施術を行わない
 * スタッフ(STAFF_TAG_EXCLUDED_IDS、2026-09-20ユーザー承認で「久保田」を追加)は
 * 候補から除外する。
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '../../../lib/repos'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { DEMO_STORE_ID, SHARED_IPAD_STAFF_USER_ID, STAFF_TAG_EXCLUDED_IDS } from '@/lib/constants'

export async function GET(req: NextRequest) {
  const staff = await extractStaffFromRequest(req)
  if (!staff) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 })
  }

  const supabase = getServiceClient()
  let query = supabase
    .from('brain_staff')
    .select('id, name')
    .eq('store_id', DEMO_STORE_ID)
    .eq('is_active', true)
    .is('deleted_at', null)
    .neq('user_id', SHARED_IPAD_STAFF_USER_ID)

  if (STAFF_TAG_EXCLUDED_IDS.length > 0) {
    query = query.not('id', 'in', `(${STAFF_TAG_EXCLUDED_IDS.join(',')})`)
  }

  const { data, error } = await query.order('name', { ascending: true })

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, staff: data ?? [] })
}
