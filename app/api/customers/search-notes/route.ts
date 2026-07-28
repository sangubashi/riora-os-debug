/**
 * GET /api/customers/search-notes — 会話履歴検索 (PHASE NOTES-SEARCH-1)
 *
 * 顧客タブ上部の検索バーから、過去の会話メモ・音声メモ・AI要約・カルテメモを
 * 横断検索する。新規テーブル・migrationは作らず、既存の customer_notes /
 * voice_notes を ilike 検索するだけ(DB構造変更禁止)。
 *
 * マッピング(既存カラムの読み替えのみ・新カラム追加なし):
 *   会話メモ   … customer_notes.note (category が設定されている行。5カテゴリの
 *                Customer Memory または音声メモAI自動保存由来)
 *   カルテメモ … customer_notes.note (category が未設定の行。CustomerBottomSheetの
 *                自由記述メモ欄由来)
 *   音声メモ   … voice_notes.transcript
 *   AI要約     … voice_notes.summary
 *
 * customer_memories(is_sensitive等を持つ別テーブル)は今回は対象外。センシティブ
 * フラグ付きコンテンツを横断検索結果に載せる設計は追加の検討が必要なため、
 * 既存の会話メモ/音声メモ機能が使っている customer_notes / voice_notes のみを
 * 対象にした(スコープを絞った判断。詳細は実装報告を参照)。
 *
 * アクセス制御: 既存の filterAccessibleCustomerIds()(AUTH-2 Rule A'/B'/C)を
 * そのまま再利用し、検索結果も「このスタッフが閲覧できる顧客」だけに絞る。
 *
 * 認証: extractStaffFromRequest(他customer系APIと同型)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { filterAccessibleCustomerIds } from '@/lib/auth/canAccessCustomer'

const MIN_QUERY_LENGTH = 2
const PER_SOURCE_LIMIT = 30
const RESULT_LIMIT = 20
const SNIPPET_RADIUS = 40

type ResultKind = 'conversation' | 'chart' | 'voice' | 'ai_summary'

interface SearchResult {
  customerId:   string
  customerName: string
  kind:         ResultKind
  matchedText:  string
  occurredAt:   string
}

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase env not configured')
  return createClient(url, key, { auth: { persistSession: false } })
}

/** マッチ箇所を中心に前後SNIPPET_RADIUS文字だけ切り出す(長文の会話メモ・音声メモ対策)。 */
function buildSnippet(text: string, query: string): string {
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return text.slice(0, SNIPPET_RADIUS * 2)
  const start = Math.max(0, idx - SNIPPET_RADIUS)
  const end = Math.min(text.length, idx + query.length + SNIPPET_RADIUS)
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}

export async function GET(req: NextRequest) {
  const staff = await extractStaffFromRequest(req)
  if (!staff) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 })
  }

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
  if (q.length < MIN_QUERY_LENGTH) {
    return NextResponse.json({ success: true, results: [] })
  }

  const supabase = getServiceClient()
  const like = `%${q}%`

  // voice_notesはtranscript/summaryを別クエリに分ける(.or()はカンマ区切りのため、
  // 検索語にカンマが含まれるとフィルタ式が壊れる。2クエリに分けて回避する)。
  const [notesRes, voiceTranscriptRes, voiceSummaryRes] = await Promise.all([
    supabase
      .from('customer_notes')
      .select('customer_id, note, category, created_at')
      .ilike('note', like)
      .order('created_at', { ascending: false })
      .limit(PER_SOURCE_LIMIT),
    supabase
      .from('voice_notes')
      .select('customer_id, transcript, summary, created_at')
      .ilike('transcript', like)
      .order('created_at', { ascending: false })
      .limit(PER_SOURCE_LIMIT),
    supabase
      .from('voice_notes')
      .select('customer_id, transcript, summary, created_at')
      .ilike('summary', like)
      .order('created_at', { ascending: false })
      .limit(PER_SOURCE_LIMIT),
  ])

  type VoiceRow = { customer_id: string; transcript: string | null; summary: string | null; created_at: string }
  const noteRows = (notesRes.data ?? []) as { customer_id: string; note: string; category: string | null; created_at: string }[]
  const voiceRowsById = new Map<string, VoiceRow>()
  for (const row of [...(voiceTranscriptRes.data ?? []), ...(voiceSummaryRes.data ?? [])] as VoiceRow[]) {
    voiceRowsById.set(`${row.customer_id}:${row.created_at}`, row)
  }
  const voiceRows = Array.from(voiceRowsById.values())

  const candidateIds = Array.from(new Set([
    ...noteRows.map(r => r.customer_id),
    ...voiceRows.map(r => r.customer_id),
  ]))
  if (candidateIds.length === 0) {
    return NextResponse.json({ success: true, results: [] })
  }

  const accessibleIds = await filterAccessibleCustomerIds(candidateIds, staff.staffBrainId, staff.isAdmin)
  if (accessibleIds.size === 0) {
    return NextResponse.json({ success: true, results: [] })
  }

  const { data: customerRows } = await supabase
    .from('brain_customers')
    .select('id, name')
    .in('id', Array.from(accessibleIds))
  const nameById = new Map((customerRows ?? []).map((c: { id: string; name: string }) => [c.id, c.name]))

  const results: SearchResult[] = []

  for (const row of noteRows) {
    if (!accessibleIds.has(row.customer_id)) continue
    const name = nameById.get(row.customer_id)
    if (!name) continue
    results.push({
      customerId:   row.customer_id,
      customerName: name,
      kind:         row.category ? 'conversation' : 'chart',
      matchedText:  buildSnippet(row.note, q),
      occurredAt:   row.created_at,
    })
  }

  for (const row of voiceRows) {
    if (!accessibleIds.has(row.customer_id)) continue
    const name = nameById.get(row.customer_id)
    if (!name) continue
    if (row.transcript && row.transcript.toLowerCase().includes(q.toLowerCase())) {
      results.push({
        customerId:   row.customer_id,
        customerName: name,
        kind:         'voice',
        matchedText:  buildSnippet(row.transcript, q),
        occurredAt:   row.created_at,
      })
    }
    if (row.summary && row.summary.toLowerCase().includes(q.toLowerCase())) {
      results.push({
        customerId:   row.customer_id,
        customerName: name,
        kind:         'ai_summary',
        matchedText:  buildSnippet(row.summary, q),
        occurredAt:   row.created_at,
      })
    }
  }

  results.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))

  return NextResponse.json({ success: true, results: results.slice(0, RESULT_LIMIT) })
}
