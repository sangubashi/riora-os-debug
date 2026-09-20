/**
 * GET  /api/customer-karte-memos?customer_id=xxx
 * POST /api/customer-karte-memos
 *
 * service role でRLSをバイパス(customer_karte_memos自体はRLSポリシーを一切定義しておらず、
 * anon/authenticatedロールからは直接アクセスできない。このAPIが唯一の入口)。
 * このAPIの返すデータは接客支援AI(ProposalOrchestrator/FireScore/TodayFocusCard等)へ
 * 渡さないこと(src/types/customerKarteMemo.tsの絶対ルールに準拠)。
 *
 * staff_idはクライアントから受け取らず、常にサーバー側でトークンから解決した
 * authUserIdを使う(なりすまし防止)。
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '../../lib/repos'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'
import { resolveStaffIdOverride } from '@/lib/staffTag/resolveStaffIdOverride'

interface KarteMemoRow {
  id:          string
  customer_id: string
  staff_id:    string | null
  content:     string
  created_at:  string
  updated_at:  string
}

async function attachStaffNames(rows: KarteMemoRow[]) {
  const staffIds = Array.from(new Set(rows.map(r => r.staff_id).filter((v): v is string => !!v)))
  if (staffIds.length === 0) return rows.map(r => ({ ...r, staffName: null as string | null }))

  const supabase = getServiceClient()
  const { data: staffRows } = await supabase
    .from('brain_staff')
    .select('user_id, name')
    .in('user_id', staffIds)

  const nameByUserId = new Map((staffRows ?? []).map((s: { user_id: string; name: string }) => [s.user_id, s.name]))
  return rows.map(r => ({ ...r, staffName: r.staff_id ? (nameByUserId.get(r.staff_id) ?? null) : null }))
}

export async function GET(req: NextRequest) {
  const staff = await extractStaffFromRequest(req)
  if (!staff) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const customerId = req.nextUrl.searchParams.get('customer_id')
  if (!customerId) {
    return NextResponse.json({ error: 'customer_id is required' }, { status: 400 })
  }

  const accessible = await canAccessCustomer(staff.staffBrainId, customerId, staff.isAdmin)
  if (!accessible) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('customer_karte_memos')
    .select('id, customer_id, staff_id, content, created_at, updated_at')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: String(error) }, { status: 500 })
  const memos = await attachStaffNames((data ?? []) as KarteMemoRow[])
  return NextResponse.json({ memos })
}

export async function POST(req: NextRequest) {
  const staff = await extractStaffFromRequest(req)
  if (!staff) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: { customer_id: string; content: string; staff_id?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.customer_id || !body.content?.trim()) {
    return NextResponse.json({ error: 'customer_id and content are required' }, { status: 400 })
  }

  const accessible = await canAccessCustomer(staff.staffBrainId, body.customer_id, staff.isAdmin)
  if (!accessible) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const supabase = getServiceClient()

  // 店舗共通ログイン+担当者タグ選択(PHASE IPAD-SHARED-LOGIN-1・2026-09-20ユーザー承認):
  // 共通アカウントからのリクエストに限り、選択済みの担当者(brain_staff.id)をstaff_id
  // (auth.users.id)へ解決して使う。個人ログイン時はbody.staff_idが送られてきても
  // 無視され、常に本人のauthUserIdが使われる(resolveStaffIdOverride参照)。
  const override = await resolveStaffIdOverride(supabase, staff, body.staff_id)

  const { data, error } = await supabase
    .from('customer_karte_memos')
    .insert({
      customer_id: body.customer_id,
      staff_id:    override?.authUserId ?? staff.authUserId,
      content:     body.content.trim(),
    })
    .select('id, customer_id, staff_id, content, created_at, updated_at')
    .single()

  if (error) return NextResponse.json({ error: String(error) }, { status: 500 })
  const [memo] = await attachStaffNames([data as KarteMemoRow])
  return NextResponse.json({ memo }, { status: 201 })
}
