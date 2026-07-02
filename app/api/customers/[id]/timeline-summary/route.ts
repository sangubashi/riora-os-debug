/**
 * GET /api/customers/[id]/timeline-summary — AI Timeline Summary (TL-5)
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
 * 出力: {
 *   success, summary, motivation, avoid,
 *   recentChange, nextFocus[],
 *   risks[], relationshipScore,
 *   cached, generated_at
 * }
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
  summary:      string                      // person_summary → summary column
  motivation:   'high' | 'medium' | 'low'
  avoid:        string | null
  recentChange: string | null               // → recent_change column
  nextFocus:    string[]                    // → next_focus column
}

export interface RiskAlert {
  code:    'long_absence' | 'price_decline' | 'nomination_change'
  message: string
}

export interface RelationshipScore {
  score:         number   // 0.0 – 5.0
  stars:         number   // 1 – 5
  visitCount:    number
  durationYears: number
  memoryCount:   number
  voiceCount:    number
}

// ─── Claude プロンプト ────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `あなたは高級美容サロンのスタッフアシスタントです。
顧客データをもとに4つのセクションを日本語で生成します。
出力はJSONのみ（前置き・コードフェンス・説明文は一切不要）。

以下の形式で出力してください:
{
  "person_summary": "このお客様はどんな人か（150文字以内の自然な文章）",
  "recent_change": "最近の変化・傾向（100文字以内。変化が読み取れない場合は null）",
  "next_focus": ["次回来店で意識すること1（20〜40文字）", "次回来店で意識すること2（20〜40文字）", "次回来店で意識すること3（20〜40文字）"],
  "motivation": "high または medium または low",
  "avoid": "避けるべき話題・センシティブな注意点（センシティブ情報がなければ null）"
}

motivationの基準:
- high: 来店5回以上、またはAI提案履歴あり、またはCustomer Memory記録3件以上
- medium: 来店2〜4回
- low: 来店0〜1回

person_summary: 来店傾向・性格・肌悩み・関心事などを自然な文体で記述（必須）
recent_change: 音声メモやCustomer Memoryから読み取れる最近の変化（購入傾向・肌状態・ライフスタイルの変化など。変化が読み取れない場合は null）
next_focus: 必ず3項目、各20〜40文字の具体的なアクション指示
avoid: is_sensitive=true のCustomer Memoryがある場合のみ記載。詳細は書かず配慮の方向性のみ`

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
        max_tokens: 600,
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
    const parsed = JSON.parse(m[0]) as {
      person_summary?: string
      recent_change?:  string | null
      next_focus?:     unknown[]
      motivation?:     string
      avoid?:          string | null
    }
    const motivation = (['high', 'medium', 'low'] as const).includes(parsed.motivation as 'high' | 'medium' | 'low')
      ? (parsed.motivation as 'high' | 'medium' | 'low')
      : 'medium'
    const nextFocus = Array.isArray(parsed.next_focus)
      ? parsed.next_focus.filter((s): s is string => typeof s === 'string').slice(0, 3)
      : []
    return {
      summary:      typeof parsed.person_summary === 'string' && parsed.person_summary.length > 0 ? parsed.person_summary : '',
      motivation,
      avoid:        typeof parsed.avoid === 'string' && parsed.avoid.length > 0 ? parsed.avoid : null,
      recentChange: typeof parsed.recent_change === 'string' && parsed.recent_change.length > 0 ? parsed.recent_change : null,
      nextFocus,
    }
  } catch (e) {
    console.error('[timeline-summary] Claude parse error:', e)
    return null
  }
}

type VisitForRisk = {
  visit_date:        string
  treatment_amount:  number | null
  retail_amount:     number | null
  staff_id?:         string | null
}

function detectRisks(visits: VisitForRisk[]): RiskAlert[] {
  const risks: RiskAlert[] = []
  if (visits.length === 0) return risks

  // 1. 来店間隔90日以上
  const daysSinceLastVisit = Math.floor((Date.now() - new Date(visits[0].visit_date).getTime()) / 86_400_000)
  if (daysSinceLastVisit >= 90) {
    risks.push({ code: 'long_absence', message: `来店間隔が${daysSinceLastVisit}日空いています` })
  }

  // 2. 指名変更（直近2回）
  if (visits.length >= 2) {
    const curr = visits[0].staff_id
    const prev = visits[1].staff_id
    if (curr && prev && curr !== prev) {
      risks.push({ code: 'nomination_change', message: '指名変更履歴があります' })
    }
  }

  // 3. 単価低下傾向（直近3回 vs 前3回）
  if (visits.length >= 6) {
    const totals = visits.slice(0, 6).map(v => (v.treatment_amount ?? 0) + (v.retail_amount ?? 0))
    const recentAvg = (totals[0] + totals[1] + totals[2]) / 3
    const prevAvg   = (totals[3] + totals[4] + totals[5]) / 3
    if (prevAvg > 0 && recentAvg < prevAvg * 0.8) {
      risks.push({ code: 'price_decline', message: '単価が前期比20%以上低下しています' })
    }
  }

  return risks
}

function computeRelationshipScore(
  visitCount:     number,
  firstVisitDate: string | null,
  memoryCount:    number,
  voiceCount:     number,
): RelationshipScore {
  let s = 0
  s += Math.min(visitCount / 5, 2)             // 0〜2 (10来店で満点)
  let durationYears = 0
  if (firstVisitDate) {
    durationYears = (Date.now() - new Date(firstVisitDate).getTime()) / (365.25 * 86_400_000)
    s += Math.min(durationYears, 1.5)           // 0〜1.5 (1.5年以上で満点)
  }
  s += Math.min(memoryCount * 0.2, 1)          // 0〜1 (5件で満点)
  s += Math.min(voiceCount * 0.25, 0.5)        // 0〜0.5 (2件で満点)
  s = Math.min(s, 5)
  return {
    score:         Math.round(s * 10) / 10,
    stars:         Math.max(1, Math.min(5, Math.ceil(s))),
    visitCount,
    durationYears: Math.round(durationYears * 10) / 10,
    memoryCount,
    voiceCount,
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

  const [visitsRes, voiceRes, memoriesRes, proposalsRes] = await Promise.allSettled([
    supabase
      .from('brain_visits')
      .select('id, visit_date, treatment_amount, retail_amount, staff_id')
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

  type VisitRow = { id: string; visit_date: string; treatment_amount: number | null; retail_amount: number | null; staff_id: string | null }
  type MemoryRow = { id: string; created_at: string; content: string; memory_type: string; importance: string; is_sensitive: boolean }

  const visits     = (visitsRes.status    === 'fulfilled' ? (visitsRes.value.data    ?? []) : []) as VisitRow[]
  const voiceNotes = (voiceRes.status     === 'fulfilled' ? (voiceRes.value.data     ?? []) : []) as Array<{ id: string; created_at: string; summary: string | null }>
  const memories   = (memoriesRes.status  === 'fulfilled' ? (memoriesRes.value.data  ?? []) : []) as MemoryRow[]
  const proposals  = (proposalsRes.status === 'fulfilled' ? (proposalsRes.value.data ?? []) : []) as Array<{ id: string; created_at: string }>

  const visitCount     = visits.length
  const lastVisitDate  = visits[0]?.visit_date ?? null
  const firstVisitDate = visits[visits.length - 1]?.visit_date ?? null
  const voiceCount     = voiceNotes.length
  const latestVoiceAt  = voiceNotes[0]?.created_at ?? null
  const memoryCount    = memories.length
  const latestMemoryAt = memories[0]?.created_at ?? null
  const proposalCount  = proposals.length

  const dataHash = computeDataHash({ visitCount, lastVisitDate, voiceCount, latestVoiceAt, memoryCount, latestMemoryAt, proposalCount })

  // 決定論ロジックは毎回計算（キャッシュ外）
  const risks             = detectRisks(visits)
  const relationshipScore = computeRelationshipScore(visitCount, firstVisitDate, memoryCount, voiceCount)

  const { data: cacheRow } = await supabase
    .from('timeline_summary_cache')
    .select('summary, motivation, focus, avoid, recent_change, next_focus, data_hash, generated_at')
    .eq('customer_id', customerId)
    .eq('store_id', STORE_ID)
    .maybeSingle()

  if (cacheRow && cacheRow.data_hash === dataHash) {
    const age = Date.now() - new Date(cacheRow.generated_at as string).getTime()
    if (age < CACHE_TTL_MS) {
      const nextFocusCached = Array.isArray(cacheRow.next_focus) ? (cacheRow.next_focus as string[]) : []
      return NextResponse.json({
        success:           true,
        summary:           cacheRow.summary,
        motivation:        cacheRow.motivation,
        focus:             cacheRow.focus,
        avoid:             cacheRow.avoid,
        recentChange:      (cacheRow.recent_change as string | null) ?? null,
        nextFocus:         nextFocusCached,
        risks,
        relationshipScore,
        cached:            true,
        generated_at:      cacheRow.generated_at,
      })
    }
  }

  const normalMemories    = memories.filter(m => !m.is_sensitive).map(m => ({ content: m.content, memory_type: m.memory_type, importance: m.importance }))
  const sensitiveMemories = memories.filter(m => m.is_sensitive).map(m => ({ content: m.content, memory_type: m.memory_type }))
  const voiceSummaries    = voiceNotes.map(n => n.summary ?? '').filter(Boolean)

  const prompt   = buildPrompt({ visitCount, lastVisitDate, voiceSummaries, normalMemories, sensitiveMemories, proposalCount })
  const aiResult = await callClaude(prompt)

  if (!aiResult || !aiResult.summary) {
    if (cacheRow) {
      const nextFocusCached = Array.isArray(cacheRow.next_focus) ? (cacheRow.next_focus as string[]) : []
      return NextResponse.json({
        success:           true,
        summary:           cacheRow.summary,
        motivation:        cacheRow.motivation,
        focus:             cacheRow.focus,
        avoid:             cacheRow.avoid,
        recentChange:      (cacheRow.recent_change as string | null) ?? null,
        nextFocus:         nextFocusCached,
        risks,
        relationshipScore,
        cached:            true,
        generated_at:      cacheRow.generated_at,
      })
    }
    return NextResponse.json({ success: false, error: 'ai_unavailable' }, { status: 503 })
  }

  const now = new Date().toISOString()
  await supabase.from('timeline_summary_cache').upsert({
    customer_id:   customerId,
    store_id:      STORE_ID,
    summary:       aiResult.summary,
    motivation:    aiResult.motivation,
    focus:         null,
    avoid:         aiResult.avoid,
    recent_change: aiResult.recentChange,
    next_focus:    aiResult.nextFocus,
    data_hash:     dataHash,
    generated_at:  now,
    updated_at:    now,
  }, { onConflict: 'customer_id,store_id' })

  return NextResponse.json({
    success:           true,
    summary:           aiResult.summary,
    motivation:        aiResult.motivation,
    focus:             null,
    avoid:             aiResult.avoid,
    recentChange:      aiResult.recentChange,
    nextFocus:         aiResult.nextFocus,
    risks,
    relationshipScore,
    cached:            false,
    generated_at:      now,
  })
}
