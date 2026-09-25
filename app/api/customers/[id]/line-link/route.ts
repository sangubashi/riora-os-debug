/**
 * GET/PATCH /api/customers/[id]/line-link — 顧客とLINE User IDの紐付け管理
 *
 * カルテアプリ(iPad)の顧客トップページ(CustomerTopPage.tsx)専用API。
 * 既存のline_user_idsテーブル構造・RLS・migrationは一切変更しない。既存の
 * /api/line/send・lineAdminQueries.tsとは独立した新規ルート(app/api/line/**は
 * 凍結対象のため、このファイルはその配下に置かない)。
 *
 * 認証: extractStaffFromRequest + canAccessCustomer(既存API(goal/route.ts等)と
 * 同一パターン)。担当者制は存在しないため requireAdmin は使用しない。
 *
 * GET: 対象顧客の現在の紐付け状態(+最新メッセージのプレビュー、getLineThreadMessages()を
 *      再利用)と、紐付け候補となる未紐付けLINEユーザー一覧(表示名で絞り込み可、?q=)を返す。
 * PATCH: { lineUserId: string | null } を受け取り、紐付け/解除を行う。
 *   - lineUserId が文字列: 指定LINE User IDの存在確認 → 既に別顧客に紐付いていないか確認
 *     → 対象顧客の既存の紐付け(あれば)を解除してから新しい紐付けをセットする
 *     (1顧客=1有効LINE User IDの前提。/api/line/send の
 *     `.eq('customer_id', customerId).is('unfollowed_at', null).maybeSingle()` が
 *     複数件ヒットで壊れないようにするため)。
 *   - lineUserId が null: 対象顧客に紐付いている行があれば解除する。
 *   最終的な紐付けキーは常に line_user_id(表示名による自動紐付けは行わない)。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServiceClient } from '../../../../lib/repos'
import { idSchema, toValidationErrorResponse } from '../../../_schemas/common'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'
import { getLineThreadMessages } from '@/lib/line/lineAdminQueries'

interface LineUserRow {
  line_user_id:  string
  display_name:  string | null
  customer_id:   string | null
  unfollowed_at: string | null
  followed_at:   string
}

async function resolveLinkedUser(
  supabase: ReturnType<typeof getServiceClient>,
  customerId: string
): Promise<LineUserRow | null> {
  const { data } = await supabase
    .from('line_user_ids')
    .select('line_user_id, display_name, customer_id, unfollowed_at, followed_at')
    .eq('customer_id', customerId)
    .order('followed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as LineUserRow | null) ?? null
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const staff = await extractStaffFromRequest(req)
  if (!staff) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const idResult = idSchema.safeParse(id)
  if (!idResult.success) {
    return NextResponse.json(toValidationErrorResponse(idResult.error), { status: 400 })
  }
  const customerId = idResult.data

  const accessible = await canAccessCustomer(staff.staffBrainId, customerId, staff.isAdmin)
  if (!accessible) {
    return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 })
  }

  const supabase = getServiceClient()

  const linked = await resolveLinkedUser(supabase, customerId)

  let lastMessage: string | null = null
  let lastAt:      string | null = null
  if (linked) {
    try {
      const messages = await getLineThreadMessages(supabase, linked.line_user_id)
      const latest = messages[messages.length - 1]
      if (latest) {
        lastMessage = latest.message
        lastAt      = latest.sentAt
      }
    } catch (e) {
      console.error('[line-link] getLineThreadMessages failed:', e)
    }
  }

  // 紐付け候補(未紐付けのLINEユーザー、表示名で絞り込み可)
  const q = req.nextUrl.searchParams.get('q')?.trim() ?? ''
  let candidateQuery = supabase
    .from('line_user_ids')
    .select('line_user_id, display_name, followed_at, unfollowed_at')
    .is('customer_id', null)
    .order('followed_at', { ascending: false })
    .limit(50)
  if (q.length > 0) {
    candidateQuery = candidateQuery.ilike('display_name', `%${q}%`)
  }
  const { data: candidateRows, error: candidateError } = await candidateQuery
  if (candidateError) {
    return NextResponse.json({ success: false, error: candidateError.message }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    linked:  linked !== null,
    lineUserId:  linked?.line_user_id ?? null,
    displayName: linked?.display_name ?? null,
    isFollowing: linked ? linked.unfollowed_at === null : false,
    lastMessage,
    lastAt,
    candidates: (candidateRows ?? []).map((row) => ({
      lineUserId:  row.line_user_id as string,
      displayName: row.display_name as string | null,
      followedAt:  row.followed_at as string,
      isFollowing: (row.unfollowed_at as string | null) === null,
    })),
  })
}

const patchBodySchema = z.object({
  lineUserId: z.string().min(1).nullable(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const staff = await extractStaffFromRequest(req)
  if (!staff) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const idResult = idSchema.safeParse(id)
  if (!idResult.success) {
    return NextResponse.json(toValidationErrorResponse(idResult.error), { status: 400 })
  }
  const customerId = idResult.data

  const accessible = await canAccessCustomer(staff.staffBrainId, customerId, staff.isAdmin)
  if (!accessible) {
    return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 })
  }

  const parsed = patchBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(toValidationErrorResponse(parsed.error), { status: 400 })
  }

  const supabase = getServiceClient()
  const targetLineUserId = parsed.data.lineUserId

  // ─── 解除 ───────────────────────────────────────────────────────────────
  if (targetLineUserId === null) {
    const { error } = await supabase
      .from('line_user_ids')
      .update({ customer_id: null, linked_at: null })
      .eq('customer_id', customerId)
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }
    return NextResponse.json({ success: true, linked: false, lineUserId: null, displayName: null })
  }

  // ─── 紐付け ─────────────────────────────────────────────────────────────
  // 指定LINE User IDの存在確認(不正なIDへの紐付け防止)。
  const { data: targetUser, error: targetError } = await supabase
    .from('line_user_ids')
    .select('line_user_id, display_name, customer_id')
    .eq('line_user_id', targetLineUserId)
    .maybeSingle()
  if (targetError) {
    return NextResponse.json({ success: false, error: targetError.message }, { status: 500 })
  }
  if (!targetUser) {
    return NextResponse.json({ success: false, error: 'line_user_not_found' }, { status: 404 })
  }
  if (targetUser.customer_id && targetUser.customer_id !== customerId) {
    return NextResponse.json({ success: false, error: 'already_linked_to_other_customer' }, { status: 409 })
  }

  // 対象顧客に既存の紐付け(別のLINE User ID)があれば先に解除する(1顧客=1有効IDの前提)。
  const { error: unlinkError } = await supabase
    .from('line_user_ids')
    .update({ customer_id: null, linked_at: null })
    .eq('customer_id', customerId)
    .neq('line_user_id', targetLineUserId)
  if (unlinkError) {
    return NextResponse.json({ success: false, error: unlinkError.message }, { status: 500 })
  }

  const { error: linkError } = await supabase
    .from('line_user_ids')
    .update({ customer_id: customerId, linked_at: new Date().toISOString() })
    .eq('line_user_id', targetLineUserId)
  if (linkError) {
    return NextResponse.json({ success: false, error: linkError.message }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    linked:  true,
    lineUserId:  targetUser.line_user_id as string,
    displayName: targetUser.display_name as string | null,
  })
}
