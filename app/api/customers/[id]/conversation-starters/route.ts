/**
 * GET /api/customers/[id]/conversation-starters — AI 今日の一言 (TL-3)
 *
 * 認証: extractStaffFromRequest + canAccessCustomer (AUTH-2 準拠)
 *
 * LLM: Claude Haiku (claude-haiku-4-5-20251001)
 * キャッシュ: timeline_conversation_cache (data_hash 一致 + 7日TTL)
 *
 * データソース優先順位:
 *   1. customer_memories (trigger_date あり・family/anniversary/life_event/travel)
 *   2. voice_notes (最新3件)
 *   3. timeline_summary_cache.focus
 *
 * 絶対禁止: 販売・営業・次回予約誘導を含む出力を生成しない。
 * 制約: Customer Memory 本文は AI Timeline 専用利用。
 *       FireScore / ProposalOrchestrator / 売上提案生成へは渡さないこと。
 *
 * 出力: { success, starters: string[], cached, generated_at }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { getServiceClient } from '../../../../lib/repos'
import { idSchema, toValidationErrorResponse } from '../../../_schemas/common'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'

const STORE_ID = '00000000-0000-0000-0000-000000000001'
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

// ─── 優先メモリタイプ ─────────────────────────────────────────────────────────

const PRIORITY_MEMORY_TYPES = ['family', 'anniversary', 'life_event', 'travel']

// ─── Claude プロンプト ────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `あなたは高級美容サロンのスタッフアシスタントです。
顧客との自然なアイスブレイクの一言を1〜3件生成します。
出力はJSONのみ（前置き・コードフェンス・説明文は一切不要）。

【絶対禁止事項 — 以下を一切含めてはならない】
・商品・サービス・コースの提案
・ホームケア製品・グッズの紹介
・次回予約への誘導・言及
・セールストーク・クロージング・背中を押す表現

【目的】
・顧客のことを「覚えている」と感じてもらう
・自然な会話から関係性を深める
・お客様の近況をさりげなく尋ねる

【許可される内容の例】
○ ご家族・お子様の話題へのフォローアップ
○ 記念日・誕生日・ライフイベントへの言及
○ 前回話されていたこと（旅行・仕事・体調）への気遣い
○ 季節・近況を聞く自然な問いかけ

【禁止例】
× ホームケアはいかがですか
× 次回予約はお決まりですか
× 新しい商品が入りましたよ
× ぜひまたご来店ください

【出力形式】
{
  "starters": [
    "「〜〜〜」",
    "「〜〜〜」"
  ]
}

・starters は1〜3件
・鉤括弧「」で囲む
・自然で温かみのある接客トーンで
・1件あたり30〜60文字程度`

// ─── ユーティリティ ────────────────────────────────────────────────────────────

function daysFromNow(dateStr: string): number {
  const target = new Date(dateStr)
  const now    = new Date()
  // 今年の日付として計算（記念日・誕生日など年次イベント対応）
  const thisYear = new Date(now.getFullYear(), target.getMonth(), target.getDate())
  const diff     = Math.round((thisYear.getTime() - now.getTime()) / 86_400_000)
  // 過去なら来年として計算
  return diff < -1 ? diff + 365 : diff
}

function computeDataHash(params: {
  priorityMemoryCount: number
  latestPriorityMemoryAt: string | null
  triggerCount: number
  earliestTriggerDate: string | null
  voiceCount: number
  latestVoiceAt: string | null
  visitCount: number
}): string {
  return createHash('sha256').update(JSON.stringify(params)).digest('hex').slice(0, 16)
}

function buildPrompt(data: {
  visitCount:       number
  lastVisitDate:    string | null
  triggerMemories:  Array<{ content: string; memory_type: string; trigger_date: string | null }>
  otherMemories:    Array<{ content: string; memory_type: string }>
  voiceSummaries:   string[]
  focus:            string | null
}): string {
  const lines: string[] = []

  lines.push(`来店情報:`)
  lines.push(`  来店回数: ${data.visitCount}回`)
  lines.push(`  直近来店日: ${data.lastVisitDate ?? '不明'}`)
  lines.push(`  今日の日付: ${new Date().toISOString().slice(0, 10)}`)

  if (data.triggerMemories.length > 0) {
    lines.push(`\n【優先】近日のイベント・記念日（trigger_date あり）:`)
    for (const m of data.triggerMemories) {
      const dayInfo = m.trigger_date ? `（${daysFromNow(m.trigger_date) >= 0 ? `${daysFromNow(m.trigger_date)}日後` : `${Math.abs(daysFromNow(m.trigger_date))}日前`}）` : ''
      lines.push(`  - [${m.memory_type}] ${m.content}${dayInfo}`)
    }
  }

  if (data.otherMemories.length > 0) {
    lines.push(`\n記憶メモ（家族・旅行・ライフイベント）:`)
    for (const m of data.otherMemories) {
      lines.push(`  - [${m.memory_type}] ${m.content}`)
    }
  }

  if (data.voiceSummaries.length > 0) {
    lines.push(`\n直近の音声メモ要約（最新${data.voiceSummaries.length}件）:`)
    data.voiceSummaries.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`))
  }

  if (data.focus) {
    lines.push(`\n接客フォーカス（AIまとめより）:`)
    lines.push(`  ${data.focus}`)
  }

  lines.push(`\n上記の情報をもとに、自然なアイスブレイクの一言を1〜3件生成してください。`)
  lines.push(`販売・次回予約・商品紹介は絶対に含めないこと。`)

  return lines.join('\n')
}

async function callClaude(prompt: string): Promise<string[] | null> {
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
        max_tokens: 256,
        system:     SYSTEM_PROMPT,
        messages:   [{ role: 'user', content: prompt }],
      }),
    })
    if (!res.ok) {
      console.error('[conversation-starters] Claude error:', res.status, await res.text())
      return null
    }
    const j   = await res.json() as { content: Array<{ type: string; text: string }> }
    const raw = j.content?.[0]?.text ?? ''
    const m   = raw.match(/\{[\s\S]*\}/)
    if (!m) return null
    const parsed = JSON.parse(m[0]) as { starters?: unknown }
    if (!Array.isArray(parsed.starters)) return null
    return (parsed.starters as unknown[])
      .filter((s): s is string => typeof s === 'string' && s.length > 0)
      .slice(0, 3)
  } catch (e) {
    console.error('[conversation-starters] Claude parse error:', e)
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
  const [visitsRes, memoriesRes, voiceRes, summaryRes] = await Promise.allSettled([
    supabase
      .from('brain_visits')
      .select('id, visit_date')
      .eq('customer_id', customerId)
      .is('deleted_at', null)
      .order('visit_date', { ascending: false })
      .limit(30),

    supabase
      .from('customer_memories')
      .select('id, created_at, content, memory_type, trigger_date, importance')
      .eq('customer_id', customerId)
      .eq('store_id', STORE_ID)
      .eq('is_sensitive', false)
      .in('memory_type', PRIORITY_MEMORY_TYPES)
      .order('importance', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(10),

    supabase
      .from('voice_notes')
      .select('id, created_at, summary')
      .eq('customer_id', customerId)
      .eq('analysis_status', 'completed')
      .not('summary', 'is', null)
      .order('created_at', { ascending: false })
      .limit(3),

    supabase
      .from('timeline_summary_cache')
      .select('focus')
      .eq('customer_id', customerId)
      .eq('store_id', STORE_ID)
      .maybeSingle(),
  ])

  type MemoryRow = {
    id: string; created_at: string; content: string
    memory_type: string; trigger_date: string | null; importance: string
  }

  const visits    = visitsRes.status    === 'fulfilled' ? (visitsRes.value.data    ?? []) : []
  const memories  = memoriesRes.status  === 'fulfilled' ? (memoriesRes.value.data  ?? []) : [] as MemoryRow[]
  const voiceNotes = voiceRes.status    === 'fulfilled' ? (voiceRes.value.data     ?? []) : []
  const focus     = summaryRes.status   === 'fulfilled' ? ((summaryRes.value.data?.focus as string | null) ?? null) : null

  const typedMemories = memories as unknown as MemoryRow[]

  const visitCount    = visits.length
  const lastVisitDate = (visits[0]?.visit_date as string | undefined) ?? null

  // trigger_date でソート: 直近30日以内のものを優先
  const triggerMemories = typedMemories
    .filter(m => m.trigger_date !== null)
    .sort((a, b) => {
      const da = Math.abs(daysFromNow(a.trigger_date!))
      const db = Math.abs(daysFromNow(b.trigger_date!))
      return da - db
    })
    .slice(0, 3)

  const otherMemories = typedMemories
    .filter(m => m.trigger_date === null)
    .slice(0, 3)

  const voiceSummaries = voiceNotes
    .map((n: { summary?: string | null }) => n.summary ?? '')
    .filter(Boolean)

  // データハッシュ
  const priorityMemoryCount   = typedMemories.length
  const latestPriorityMemoryAt = (typedMemories[0]?.created_at) ?? null
  const triggerCount           = triggerMemories.length
  const earliestTriggerDate    = triggerMemories[0]?.trigger_date ?? null
  const voiceCount             = voiceNotes.length
  const latestVoiceAt          = (voiceNotes[0] as { created_at?: string } | undefined)?.created_at ?? null

  const dataHash = computeDataHash({
    priorityMemoryCount,
    latestPriorityMemoryAt,
    triggerCount,
    earliestTriggerDate,
    voiceCount,
    latestVoiceAt,
    visitCount,
  })

  // キャッシュ確認
  const { data: cacheRow } = await supabase
    .from('timeline_conversation_cache')
    .select('starters, data_hash, generated_at')
    .eq('customer_id', customerId)
    .eq('store_id', STORE_ID)
    .maybeSingle()

  if (cacheRow && cacheRow.data_hash === dataHash) {
    const age = Date.now() - new Date(cacheRow.generated_at as string).getTime()
    if (age < CACHE_TTL_MS) {
      return NextResponse.json({
        success:      true,
        starters:     cacheRow.starters as string[],
        cached:       true,
        generated_at: cacheRow.generated_at,
      })
    }
  }

  // Claude 呼び出し
  const prompt  = buildPrompt({ visitCount, lastVisitDate, triggerMemories, otherMemories, voiceSummaries, focus })
  const starters = await callClaude(prompt)

  if (!starters || starters.length === 0) {
    if (cacheRow) {
      return NextResponse.json({
        success:      true,
        starters:     cacheRow.starters as string[],
        cached:       true,
        generated_at: cacheRow.generated_at,
      })
    }
    return NextResponse.json({ success: false, error: 'ai_unavailable' }, { status: 503 })
  }

  // キャッシュ upsert
  const now = new Date().toISOString()
  await supabase.from('timeline_conversation_cache').upsert({
    customer_id:  customerId,
    store_id:     STORE_ID,
    starters:     starters,
    data_hash:    dataHash,
    generated_at: now,
    updated_at:   now,
  }, { onConflict: 'customer_id,store_id' })

  return NextResponse.json({
    success:      true,
    starters,
    cached:       false,
    generated_at: now,
  })
}
