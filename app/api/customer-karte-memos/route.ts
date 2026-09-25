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
 *
 * memo_date(任意・2026-09-25ユーザー承認・過去カルテメモの遡及登録機能): "YYYY-MM-DD"を
 * 渡すと、created_atをその日付の正午(JST)に設定してINSERTする(通常は省略時どおり
 * DBのデフォルトnow()が使われる)。移行期でアプリ導入前の来店(brain_visits)には
 * カルテメモが一件も無いため、スタッフがサロンボード等からコピーした過去メモを、
 * VisitHistorySection.tsx(来店履歴の各来店日)からその来店日付きで登録できるように
 * するための拡張。テーブル構造(migration)は変更していない(created_at列は元々
 * timestamptzで任意の値をINSERT可能、DEFAULT now()を明示値で上書きするだけ)。
 * 未来日は拒否する。
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

  let body: { customer_id: string; content: string; staff_id?: string; memo_date?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.customer_id || !body.content?.trim()) {
    return NextResponse.json({ error: 'customer_id and content are required' }, { status: 400 })
  }

  // memo_date(過去カルテメモの遡及登録・任意): "YYYY-MM-DD"のみ許可し、正午(JST)の
  // timestamptzへ変換する。未来日・不正な形式は拒否する。
  let createdAtOverride: string | undefined
  if (body.memo_date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.memo_date)) {
      return NextResponse.json({ error: 'invalid_memo_date' }, { status: 400 })
    }
    const candidate = `${body.memo_date}T12:00:00+09:00`
    const parsedMs = new Date(candidate).getTime()
    if (Number.isNaN(parsedMs)) {
      return NextResponse.json({ error: 'invalid_memo_date' }, { status: 400 })
    }
    if (parsedMs > Date.now()) {
      return NextResponse.json({ error: 'memo_date_in_future' }, { status: 400 })
    }
    createdAtOverride = candidate
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
      ...(createdAtOverride ? { created_at: createdAtOverride } : {}),
    })
    .select('id, customer_id, staff_id, content, created_at, updated_at')
    .single()

  if (error) return NextResponse.json({ error: String(error) }, { status: 500 })
  const [memo] = await attachStaffNames([data as KarteMemoRow])
  return NextResponse.json({ memo }, { status: 201 })
}
