/**
 * GET /api/customers/[id]/timeline-summary — AI Timeline Summary (TL-2)
 *
 * 認証: extractStaffFromRequest + canAccessCustomer (AUTH-2 準拠)
 *
 * LLM: Claude Haiku (claude-haiku-4-5-20251001)
 * キャッシュ: timeline_summary_cache (data_hash 一致 + 7日TTL)
 *
 * 制約:
 *   - Customer Memory 本文は AI Timeline 専用。
 *     FireScore / ProposalOrchestrator / 売上提案生成へは渡さないこと。
 *
 * 出力: { success, summary, motivation, focus, avoid, cached, generated_at }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { getServiceClient } from '../../../../lib/repos'
import { idSchema, toValidationErrorResponse } from '../../../_schemas/common'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'

const STORE_ID = '00000000-0000-0000-0000-000000000001'
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

// ─── 型 ──────────────────────────────────────────────────────────────────────

interface AISummary {
  summary:    string
  motivation: 'high' | 'medium' | 'low'
  focus:      string | null
  avoid:      string | null
}

// ─── Claude プロンプト ────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `あなたは高級美容サロンのスタッフアシスタントです。
顧客データをもとに「この顧客はどんな人か」を5〜8行の自然な日本語で要約します。
出力はJSONのみ（前置き・コードフェンス・説明文は一切不要）。

以下の形式で出力してください:
{
  "summary": "顧客についての5〜8行の要約（来店傾向・性格・肌悩み・関心事などを自然に記述）",
  "motivation": "high または medium または low",
  "focus": "次回の接客で最も意識すべきポイント（1〜2文）",
  "avoid": "避けるべき話題・センシティブな注意点（センシティブ情報がなければ null）"
}

motivationの基準:
- high: 来店5回以上、またはAI提案履歴あり、またはCustomer Memory記録3件以上
- medium: 来店2〜4回
- low: 来店0〜1回

avoid フィールドの注意:
- is_sensitive=true のCustomer Memoryがある場合のみ記載する
- 詳細な内容は書かず「〇〇の話題には注意が必要」など配慮の方向性のみ記述する
- センシティブ情報がない場合は null を返す`

// ─── ユーティリティ ────────────────────────────────────────────────────────

function computeDataHash(params: {
  visitCount:     number
  lastVisitDate:  string | null
  voiceCount:     number
  latestVoiceAt:  string | null
  memoryCount:    number
  latestMemoryAt: string | null
  proposalCount:  number
}): string {
  return createHash('sha256').update(JSON.stringify(params)).digest('hex').slice(0, 16)
}

function buildPrompt(data: {
  visitCount:        number
  lastVisitDate:     string | null
  voiceSummaries:    string[]
  normalMemories:    Array<{ content: string; memory_type: string; importance: string }>
  sensitiveMemories: Array<{ content: string; memory_type: string }>
  proposalCount:     number
}): string {
  const lines: string[] = []

  lines.push(`来店情報:`)
  lines.push(`  - 来店回数: ${data.visitCount}回`)
  lines.push(`  - 直近来店日: ${data.lastVisitDate ?? '不明'}`)

  if (data.voiceSummaries.length > 0) {
    lines.push(`\n直近の音声メモ要約（最新${data.voiceSummaries.length}件）:`)
    data.voiceSummaries.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`))
  }

  if (data.normalMemories.length > 0) {
    lines.push(`\nCustomer Memory（重要度順）:`)
    data.normalMemories.forEach(m => lines.push(`  - [${m.memory_type}] ${m.content}`))
  }

  if (data.sensitiveMemories.length > 0) {
    lines.push(`\nセンシティブな顧客情報（スタッフのみ参照・avoid生成用）:`)
    data.sensitiveMemories.forEach(m => lines.push(`  - [${m.memory_type}] ${m.content}`))
  }

  if (data.proposalCount > 0) {
    lines.push(`\nAI提案履歴: ${data.proposalCount}件あり`)
  }

  return lines.join('\n')
}

async function callClaude(prompt: string): Promise<AISummary | null> {
  if (!ANTHROPIC_KEY) return null
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'content-type':      'application/json',
        'x-api-key':         ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 512,
        system:     SYSTEM_PROMPT,
        messages:   [{ role: 'user', content: prompt }],
      }),
    })
    if (!res.ok) {
      console.error('[timeline-summary] Claude error:', res.status, await res.text())
      return null
    }
    const j   = await res.json() as { content: Array<{ type: string; text: string }> }
    const raw = j.content?.[0]?.text ?? ''
    const m   = raw.match(/\{[\s\S]*\}/)
    if (!m) return null
    const parsed = JSON.parse(m[0]) as Partial<AISummary>
    const motivation = (['high', 'medium', 'low'] as const).includes(parsed.motivation as 'high' | 'medium' | 'low')
      ? (parsed.motivation as 'high' | 'medium' | 'low')
      : 'medium'
    return {
      summary:    typeof parsed.summary === 'string' && parsed.summary.length > 0 ? parsed.summary : '',
      motivation,
      focus:      typeof parsed.focus === 'string' && parsed.focus.length > 0 ? parsed.focus : null,
      avoid:      typeof parsed.avoid === 'string' && parsed.avoid.length > 0 ? parsed.avoid : null,
    }
  } catch (e) {
    console.error('[timeline-summary] Claude parse error:', e)
    return null
  }
}

// ─── ハンドラー ────────────────────────────────────────────────────────────────

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

  // 並列データ取得
  const [visitsRes, voiceRes, memoriesRes, proposalsRes] = await Promise.allSettled([
    supabase
      .from('brain_visits')
      .select('id, visit_date')
      .eq('customer_id', customerId)
      .is('deleted_at', null)
      .order('visit_date', { ascending: false })
      .limit(50),

    supabase
      .from('voice_notes')
      .select('id, created_at, summary')
      .eq('customer_id', customerId)
      .eq('analysis_status', 'completed')
      .not('summary', 'is', null)
      .order('created_at', { ascending: false })
      .limit(5),

    supabase
      .from('customer_memories')
      .select('id, created_at, content, memory_type, importance, is_sensitive')
      .eq('customer_id', customerId)
      .eq('store_id', STORE_ID)
      .order('importance', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(20),

    supabase
      .from('brain_pattern_fire_log')
      .select('id, created_at')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  const visits    = visitsRes.status    === 'fulfilled' ? (visitsRes.value.data    ?? []) : []
  const voiceNotes = voiceRes.status    === 'fulfilled' ? (voiceRes.value.data     ?? []) : []
  const memories  = memoriesRes.status  === 'fulfilled' ? (memoriesRes.value.data  ?? []) : []
  const proposals = proposalsRes.status === 'fulfilled' ? (proposalsRes.value.data ?? []) : []

  type MemoryRow = { id: string; created_at: string; content: string; memory_type: string; importance: string; is_sensitive: boolean }
  const typedMemories = memories as unknown as MemoryRow[]

  const visitCount     = visits.length
  const lastVisitDate  = (visits[0]?.visit_date as string | undefined) ?? null
  const voiceCount     = voiceNotes.length
  const latestVoiceAt  = (voiceNotes[0]?.created_at as string | undefined) ?? null
  const memoryCount    = memories.length
  const latestMemoryAt = (memories[0]?.created_at as string | undefined) ?? null
  const proposalCount  = proposals.length

  // キャッシュ確認
  const dataHash = computeDataHash({ visitCount, lastVisitDate, voiceCount, latestVoiceAt, memoryCount, latestMemoryAt, proposalCount })

  const { data: cacheRow } = await supabase
    .from('timeline_summary_cache')
    .select('summary, motivation, focus, avoid, data_hash, generated_at')
    .eq('customer_id', customerId)
    .eq('store_id', STORE_ID)
    .maybeSingle()

  if (cacheRow && cacheRow.data_hash === dataHash) {
    const age = Date.now() - new Date(cacheRow.generated_at as string).getTime()
    if (age < CACHE_TTL_MS) {
      return NextResponse.json({
        success:      true,
        summary:      cacheRow.summary,
        motivation:   cacheRow.motivation,
        focus:        cacheRow.focus,
        avoid:        cacheRow.avoid,
        cached:       true,
        generated_at: cacheRow.generated_at,
      })
    }
  }

  // Claude 呼び出し
  const normalMemories    = typedMemories.filter(m => !m.is_sensitive).map(m => ({ content: m.content, memory_type: m.memory_type, importance: m.importance }))
  const sensitiveMemories = typedMemories.filter(m => m.is_sensitive).map(m => ({ content: m.content, memory_type: m.memory_type }))
  const voiceSummaries    = voiceNotes.map((n: { summary?: string | null }) => n.summary ?? '').filter(Boolean)

  const prompt = buildPrompt({ visitCount, lastVisitDate, voiceSummaries, normalMemories, sensitiveMemories, proposalCount })
  const aiResult = await callClaude(prompt)

  if (!aiResult || !aiResult.summary) {
    // ANTHROPIC_API_KEY 未設定 or 生成失敗時: キャッシュがあれば期限切れでも返す
    if (cacheRow) {
      return NextResponse.json({
        success:      true,
        summary:      cacheRow.summary,
        motivation:   cacheRow.motivation,
        focus:        cacheRow.focus,
        avoid:        cacheRow.avoid,
        cached:       true,
        generated_at: cacheRow.generated_at,
      })
    }
    return NextResponse.json({ success: false, error: 'ai_unavailable' }, { status: 503 })
  }

  // キャッシュ upsert
  const now = new Date().toISOString()
  await supabase.from('timeline_summary_cache').upsert({
    customer_id:  customerId,
    store_id:     STORE_ID,
    summary:      aiResult.summary,
    motivation:   aiResult.motivation,
    focus:        aiResult.focus,
    avoid:        aiResult.avoid,
    data_hash:    dataHash,
    generated_at: now,
    updated_at:   now,
  }, { onConflict: 'customer_id,store_id' })

  return NextResponse.json({
    success:      true,
    summary:      aiResult.summary,
    motivation:   aiResult.motivation,
    focus:        aiResult.focus,
    avoid:        aiResult.avoid,
    cached:       false,
    generated_at: now,
  })
}
