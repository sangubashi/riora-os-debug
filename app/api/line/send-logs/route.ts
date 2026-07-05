/**
 * GET /api/line/send-logs
 *
 * line_send_logs の最新 20 件を返す（Pass S-1 テスト送信ログ表示用）。
 * service_role で RLS バイパスして全件取得する。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/auth/requireAdmin'

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req)
  if (gate instanceof NextResponse) return gate

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    return NextResponse.json({ ok: false, error: 'Supabase env not configured' }, { status: 500 })
  }

  const supabase = createClient(url, key)

  const { data, error } = await supabase
    .from('line_send_logs')
    .select('id, message_body, status, sent_at, metadata')
    .order('sent_at', { ascending: false })
    .limit(20)

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, logs: data ?? [] })
}
