/**
 * POST /api/voice/pipeline
 *
 * Voice Memo 保存後に呼ばれる AI 解析パイプライン。
 * クライアントは fire-and-forget で呼ぶ（レスポンスを待たなくてよい）。
 *
 * フロー:
 *   1. Supabase Storage から音声ダウンロード
 *   2. OpenAI Whisper で日本語文字起こし
 *   3. Claude Haiku で 4 カテゴリ同時解析
 *      - customer_notes (Family/Work/Health/Preference/Event)
 *      - booking_prompt (接客ポイント・推奨提案)
 *      - handover_notes (引継ぎサマリー)
 *      - contraindications (施術禁忌・注意事項)
 *   4. voice_notes を completed に更新
 *   5. 4 テーブルへ保存
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { extractInsightTags } from '@/lib/voiceInsight/extractInsightTags'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const OPENAI_KEY = process.env.OPENAI_API_KEY
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY
const STORE_ID = '00000000-0000-0000-0000-000000000001'

// customer_notes と同じ Family/Work/Health/Preference/Event 分類を
// customer_memories の memory_type へマッピング（VoiceMemoSection.tsx の
// CATEGORY_TO_MEMORY_TYPE と同一定義）
const CATEGORY_TO_MEMORY_TYPE: Record<string, string> = {
  Family:     'family',
  Work:       'occupation',
  Health:     'other',
  Preference: 'hobby',
  Event:      'life_event',
}

// ─── 型定義 ──────────────────────────────────────────────────────────────────

interface PipelineRequest {
  voiceNoteId:   string
  storagePath:   string
  customerId:    string
  staffId:       string
  durationSec:   number
  reservationId: string | null
}

interface ClaudeAnalysis {
  customerNotes: Array<{
    category: 'Family' | 'Work' | 'Health' | 'Preference' | 'Event'
    note:     string
  }>
  bookingPrompt: {
    summary:               string
    recommended_topics:    string[]
    recommended_proposals: string[]
    risk_flags:            string[]
    confidence:            number
  }
  handoverNotes: {
    summary:             string
    customer_context:    string[]
    open_tasks:          string[]
    recommended_actions: string[]
    risk_flags:          string[]
    confidence:          number
  }
  contraindications: Array<{
    severity:       'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
    title:          string
    description:    string
    recommendation: string
    confidence:     number
  }>
}

// ─── Whisper 文字起こし ───────────────────────────────────────────────────────

async function transcribeWithWhisper(
  audioBuffer: ArrayBuffer,
  mimeType:    string,
): Promise<string> {
  if (!OPENAI_KEY) throw new Error('OPENAI_API_KEY が未設定です')

  const ext = mimeType.includes('mp4') || mimeType.includes('aac') ? 'm4a' : 'webm'
  const fd  = new FormData()
  fd.append('file', new Blob([audioBuffer], { type: mimeType }), `audio.${ext}`)
  fd.append('model', 'whisper-1')
  fd.append('language', 'ja')
  fd.append('response_format', 'text')

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method:  'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}` },
    body:    fd,
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Whisper API エラー: ${res.status} ${err.slice(0, 200)}`)
  }

  return (await res.text()).trim()
}

// ─── Claude 解析 ──────────────────────────────────────────────────────────────

const CLAUDE_SYSTEM = `あなたは高級美容サロンの接客アシスタントです。
施術後のスタッフの音声メモ（文字起こし済み）を解析し、以下の4つのカテゴリに整理されたJSONを返します。

出力はJSON のみ（前置き・コードフェンス・説明文は一切不要）:
{
  "customerNotes": [
    { "category": "Family|Work|Health|Preference|Event", "note": "顧客情報を端的に記述" }
  ],
  "bookingPrompt": {
    "summary": "次回来店時のスタッフへの接客ポイント（100字以内）",
    "recommended_topics": ["話題候補1", "話題候補2"],
    "recommended_proposals": ["提案1", "提案2"],
    "risk_flags": ["注意事項1"],
    "confidence": 0.0〜1.0
  },
  "handoverNotes": {
    "summary": "引継ぎ用サマリー（60字以内）",
    "customer_context": ["文脈情報1", "文脈情報2"],
    "open_tasks": ["未完了タスク1"],
    "recommended_actions": ["推奨アクション1"],
    "risk_flags": ["引継ぎ注意事項"],
    "confidence": 0.0〜1.0
  },
  "contraindications": [
    {
      "severity": "CRITICAL|HIGH|MEDIUM|LOW",
      "title": "禁忌・注意項目名（短く）",
      "description": "詳細説明",
      "recommendation": "対応方法",
      "confidence": 0.0〜1.0
    }
  ]
}

【カテゴリ定義】
- Family: 家族・子供・夫婦・親・育児に関する情報
- Work: 仕事・職場・残業・転職・キャリア
- Health: 体調・病気・アレルギー・睡眠・疲労・肌の悩み
- Preference: 趣味・好み・ライフスタイル
- Event: 結婚式・誕生日・旅行・記念日・入学など予定されたイベント

【禁忌の重要度】
- CRITICAL: 施術禁止（重篤アレルギー・投薬中など）
- HIGH: 要確認（敏感肌・刺激反応歴）
- MEDIUM: 注意が必要（乾燥・エイジング）
- LOW: 参考情報（軽微な懸念）

情報が少ない場合は空配列・null を返し、虚偽の情報を創作しないこと。
医療的診断・薬機法違反表現（治る・効果がある等）は使わないこと。`

function mockAnalysis(transcript: string): ClaudeAnalysis {
  const t = transcript.slice(0, 60)
  return {
    customerNotes: [
      { category: 'Health', note: `${t.slice(0, 30)}（音声メモより）` },
    ],
    bookingPrompt: {
      summary: `次回接客メモ: ${t.slice(0, 50)}`,
      recommended_topics: ['前回の施術内容', '現在のコンディション'],
      recommended_proposals: ['ホームケア継続', '次回メニュー提案'],
      risk_flags: [],
      confidence: 0.5,
    },
    handoverNotes: {
      summary: `引継ぎ: ${t.slice(0, 40)}`,
      customer_context: ['音声メモによる情報'],
      open_tasks: [],
      recommended_actions: ['フォローアップ確認'],
      risk_flags: [],
      confidence: 0.5,
    },
    contraindications: [],
  }
}

async function analyzeWithClaude(transcript: string): Promise<ClaudeAnalysis> {
  if (!ANTHROPIC_KEY) {
    console.warn('[pipeline] ANTHROPIC_API_KEY 未設定 → mock analysis 使用')
    return mockAnalysis(transcript)
  }

  const EMPTY: ClaudeAnalysis = {
    customerNotes: [],
    bookingPrompt: {
      summary: transcript.slice(0, 80),
      recommended_topics: [], recommended_proposals: [],
      risk_flags: [], confidence: 0.3,
    },
    handoverNotes: {
      summary: transcript.slice(0, 60),
      customer_context: [], open_tasks: [],
      recommended_actions: [], risk_flags: [], confidence: 0.3,
    },
    contraindications: [],
  }

  if (!transcript || transcript.length < 10) return EMPTY

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
        max_tokens: 1024,
        system:     CLAUDE_SYSTEM,
        messages:   [{ role: 'user', content: `音声メモ文字起こし:\n${transcript}` }],
      }),
    })

    if (!res.ok) {
      console.error('[pipeline] Claude API error:', res.status, await res.text())
      return EMPTY
    }

    const j  = await res.json() as { content: Array<{ type: string; text: string }> }
    const raw = j.content?.[0]?.text ?? ''
    const m   = raw.match(/\{[\s\S]*\}/)
    if (!m) return EMPTY

    const parsed = JSON.parse(m[0]) as Partial<ClaudeAnalysis>
    return {
      customerNotes:    (parsed.customerNotes ?? []).filter(n =>
        ['Family','Work','Health','Preference','Event'].includes(n.category) && n.note?.length > 3
      ),
      bookingPrompt: {
        summary:               parsed.bookingPrompt?.summary ?? transcript.slice(0, 80),
        recommended_topics:    parsed.bookingPrompt?.recommended_topics ?? [],
        recommended_proposals: parsed.bookingPrompt?.recommended_proposals ?? [],
        risk_flags:            parsed.bookingPrompt?.risk_flags ?? [],
        confidence:            clamp(parsed.bookingPrompt?.confidence ?? 0.5),
      },
      handoverNotes: {
        summary:             parsed.handoverNotes?.summary ?? transcript.slice(0, 60),
        customer_context:    parsed.handoverNotes?.customer_context ?? [],
        open_tasks:          parsed.handoverNotes?.open_tasks ?? [],
        recommended_actions: parsed.handoverNotes?.recommended_actions ?? [],
        risk_flags:          parsed.handoverNotes?.risk_flags ?? [],
        confidence:          clamp(parsed.handoverNotes?.confidence ?? 0.5),
      },
      contraindications: (parsed.contraindications ?? []).filter(c =>
        ['CRITICAL','HIGH','MEDIUM','LOW'].includes(c.severity) && c.title
      ),
    }
  } catch (e) {
    console.error('[pipeline] Claude parse error:', e)
    return EMPTY
  }
}

function clamp(v: number): number { return Math.max(0, Math.min(1, v)) }

// ─── customer_memories 候補生成（P1: Whisper/Claude実データ連結） ─────────────
//
// 優先順位:
//   1位 analysis.customerNotes（Claude解析済みのFamily/Work/Health/Preference/Event
//       分類＋実文。insight_tags(dryness_concern等の肌悩み/購買シグナル)は文章を
//       伴わずcontentを構成できないため、同じ「解析済み構造化データ」の中で
//       実際にcontentとして使えるcustomerNotesを1位に採用する）
//   2位 summary（bookingPrompt優先、なければhandoverNotes）
//   3位 transcript全文（先頭80文字）
interface MemoryCandidate { content: string; memoryType: string }

function buildMemoryCandidates(analysis: ClaudeAnalysis, transcript: string): MemoryCandidate[] {
  if (analysis.customerNotes.length > 0) {
    return analysis.customerNotes.map(n => ({
      content:    n.note,
      memoryType: CATEGORY_TO_MEMORY_TYPE[n.category] ?? 'other',
    }))
  }

  const summary = analysis.bookingPrompt.summary || analysis.handoverNotes.summary
  if (summary && summary.trim().length > 0) {
    return [{ content: summary.trim(), memoryType: 'other' }]
  }

  if (transcript && transcript.trim().length > 0) {
    return [{ content: `接客内容を記録: ${transcript.trim().slice(0, 80)}`, memoryType: 'other' }]
  }

  return []
}

// ─── メインハンドラー ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const staff = await extractStaffFromRequest(req)
  if (!staff) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: PipelineRequest
  try {
    body = await req.json() as PipelineRequest
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  const { voiceNoteId, storagePath, customerId, staffId, durationSec, reservationId } = body
  if (!voiceNoteId || !storagePath || !customerId || !staffId) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 })
  }

  const sb = createClient(SB_URL, SVC_KEY)
  const now = new Date().toISOString()

  try {
    // ── 1. analysis_status → processing ──
    await sb.from('voice_notes')
      .update({ analysis_status: 'processing' })
      .eq('id', voiceNoteId)

    // ── 2. Storage から音声ダウンロード ──
    const { data: fileData, error: dlErr } = await sb.storage
      .from('voice-notes')
      .download(storagePath)

    if (dlErr || !fileData) {
      throw new Error(`Storage download failed: ${dlErr?.message}`)
    }

    const audioBuffer = await fileData.arrayBuffer()
    const mimeType    = fileData.type || 'audio/webm'
    console.log(`[pipeline] 音声ダウンロード完了 size=${audioBuffer.byteLength} type=${mimeType}`)

    // ── 3. Whisper 文字起こし ──
    let transcript = ''
    if (OPENAI_KEY) {
      try {
        transcript = await transcribeWithWhisper(audioBuffer, mimeType)
        console.log(`[pipeline] Whisper transcript (${transcript.length}文字): ${transcript.slice(0, 60)}…`)
      } catch (whisperErr) {
        // 無効音声フォーマット・短すぎる音声等は空文字で続行（Claudeが空分析を返す）
        console.warn('[pipeline] Whisper 失敗 → 空transcript で続行:', (whisperErr as Error).message)
        transcript = ''
      }
    } else {
      // OPENAI_KEY 未設定時のフォールバック（録音秒数ベースのモック）
      console.warn('[pipeline] OPENAI_API_KEY 未設定 → mock transcript 使用')
      transcript = durationSec <= 15
        ? 'お肌の乾燥が気になるとのことでした。'
        : durationSec <= 45
          ? '娘さんの誕生日イベントに向けてケアしたいとのことでした。仕事が残業続きで乾燥とエイジングが気になると話していました。'
          : '今日のお客様は家族旅行の予定があり、お子さんの入学式に向けてお肌をきれいにしたいとのことでした。職場では残業が多くて疲れている様子で、睡眠不足による肌荒れが悩みとのこと。次回は美白ケアを試してみたいとのことでした。'
    }

    // ── 4. Claude 4 カテゴリ同時解析 ──
    const analysis = await analyzeWithClaude(transcript)
    console.log(`[pipeline] Claude解析完了 cn=${analysis.customerNotes.length} ci=${analysis.contraindications.length}`)

    // ── 4.5. insight_tags 抽出（決定論的キーワードマッチング・AI不使用） ──
    const { tags: insightTags } = extractInsightTags([transcript])
    console.log(`[pipeline] insight_tags抽出完了: ${insightTags.length}件 [${insightTags.join(', ')}]`)

    // ── 5. voice_notes 更新（completed）──
    const { error: vnErr } = await sb.from('voice_notes').update({
      transcript,
      summary:          analysis.bookingPrompt.summary,
      analysis_status:  'completed',
      analyzed_at:      now,
      insight_summary:  analysis.handoverNotes.summary,
      insight_tags:     insightTags,
    }).eq('id', voiceNoteId)
    if (vnErr) {
      console.error('[pipeline] voice_notes update error:', vnErr.message)
    } else {
      console.log(`[pipeline] voice_notes保存確認: transcript=${transcript.length}文字 summary=${analysis.bookingPrompt.summary.length}文字 insight_tags=${insightTags.length}件`)
    }

    // ── 6. customer_notes INSERT（重複チェック付き）──
    if (analysis.customerNotes.length > 0) {
      const { data: existing } = await sb.from('customer_notes')
        .select('category, note')
        .eq('customer_id', customerId)
        .not('category', 'is', null)

      const existingSet = new Set(
        (existing ?? []).map(r => `${r.category}:${r.note.slice(0, 30)}`)
      )

      const toInsert = analysis.customerNotes
        .filter(n => !existingSet.has(`${n.category}:${n.note.slice(0, 30)}`))
        .map(n => ({
          customer_id:   customerId,
          staff_id:      staffId,
          note:          n.note,
          category:      n.category,
          source:        'voice_note',
          voice_note_id: voiceNoteId,
        }))

      if (toInsert.length > 0) {
        const { error: cnErr } = await sb.from('customer_notes').insert(toInsert)
        if (cnErr) console.error('[pipeline] customer_notes insert error:', cnErr.message)
        else console.log(`[pipeline] customer_notes ${toInsert.length}件保存`)
      }
    }

    // ── 6.5. customer_memories 生成（P1: Whisper/Claude実データ連結・重複チェック付き）──
    const memoryCandidates = buildMemoryCandidates(analysis, transcript)
    let memoriesInserted = 0
    if (memoryCandidates.length > 0) {
      const { data: existingMem } = await sb.from('customer_memories')
        .select('content')
        .eq('customer_id', customerId)

      const existingContents = new Set((existingMem ?? []).map(m => (m.content as string).slice(0, 30)))

      const memToInsert = memoryCandidates
        .filter(c => !existingContents.has(c.content.slice(0, 30)))
        .map(c => ({
          customer_id:  customerId,
          store_id:     STORE_ID,
          content:      c.content,
          memory_type:  c.memoryType,
          importance:   'medium',
          is_sensitive: false,
          created_by:   staffId,
        }))

      if (memToInsert.length > 0) {
        const { error: memErr } = await sb.from('customer_memories').insert(memToInsert)
        if (memErr) console.error('[pipeline] customer_memories insert error:', memErr.message)
        else {
          memoriesInserted = memToInsert.length
          console.log(`[pipeline] customer_memories ${memToInsert.length}件保存`)
        }
      }
    }

    // ── 7. booking_prompts UPSERT ──
    const bp = analysis.bookingPrompt
    // 既存レコード確認
    const { data: existBP } = await sb.from('booking_prompts')
      .select('id')
      .eq('customer_id', customerId)
      .is('reservation_id', reservationId ?? null)
      .order('created_at', { ascending: false })
      .limit(1)

    if (existBP && existBP.length > 0) {
      await sb.from('booking_prompts').update({
        summary:               bp.summary,
        recommended_topics:    bp.recommended_topics,
        recommended_proposals: bp.recommended_proposals,
        risk_flags:            bp.risk_flags,
        confidence:            bp.confidence,
        generated_at:          now,
      }).eq('id', existBP[0].id)
    } else {
      await sb.from('booking_prompts').insert({
        customer_id:            customerId,
        reservation_id:         reservationId ?? null,
        store_id:               null,
        summary:                bp.summary,
        recommended_topics:     bp.recommended_topics,
        recommended_proposals:  bp.recommended_proposals,
        risk_flags:             bp.risk_flags,
        confidence:             bp.confidence,
        generated_at:           now,
      })
    }
    console.log('[pipeline] booking_prompts 保存完了')

    // ── 8. handover_notes UPSERT ──
    const hn = analysis.handoverNotes
    const { data: existHN } = await sb.from('handover_notes')
      .select('id')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(1)

    if (existHN && existHN.length > 0) {
      await sb.from('handover_notes').update({
        summary:             hn.summary,
        customer_context:    hn.customer_context,
        open_tasks:          hn.open_tasks,
        recommended_actions: hn.recommended_actions,
        risk_flags:          hn.risk_flags,
        confidence:          hn.confidence,
        generated_at:        now,
      }).eq('id', existHN[0].id)
    } else {
      await sb.from('handover_notes').insert({
        customer_id:         customerId,
        reservation_id:      reservationId ?? null,
        store_id:            null,
        summary:             hn.summary,
        customer_context:    hn.customer_context,
        open_tasks:          hn.open_tasks,
        recommended_actions: hn.recommended_actions,
        risk_flags:          hn.risk_flags,
        confidence:          hn.confidence,
        generated_at:        now,
      })
    }
    console.log('[pipeline] handover_notes 保存完了')

    // ── 9. contraindications INSERT（title で重複チェック）──
    if (analysis.contraindications.length > 0) {
      const { data: existCI } = await sb.from('contraindications')
        .select('title')
        .eq('customer_id', customerId)

      const existTitles = new Set((existCI ?? []).map(c => c.title))

      const ciToInsert = analysis.contraindications
        .filter(c => !existTitles.has(c.title))
        .map(c => ({
          customer_id:    customerId,
          reservation_id: reservationId ?? null,
          store_id:       null,
          severity:       c.severity,
          title:          c.title,
          description:    c.description,
          recommendation: c.recommendation,
          source:         'voice_notes',
          source_note_id: voiceNoteId,
          confidence:     c.confidence,
          generated_at:   now,
        }))

      if (ciToInsert.length > 0) {
        const { error: ciErr } = await sb.from('contraindications').insert(ciToInsert)
        if (ciErr) console.error('[pipeline] contraindications insert error:', ciErr.message)
        else console.log(`[pipeline] contraindications ${ciToInsert.length}件保存`)
      }
    }

    const result = {
      success:       true,
      voiceNoteId,
      transcript,
      analysis: {
        customerNotesCount:      analysis.customerNotes.length,
        contraindicationsCount:  analysis.contraindications.length,
        customerMemoriesCount:   memoriesInserted,
        bookingPromptConfidence: bp.confidence,
        handoverConfidence:      hn.confidence,
      },
    }
    console.log('[pipeline] 全処理完了:', JSON.stringify(result.analysis))
    return NextResponse.json(result)

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[pipeline] エラー:', msg)

    // analysis_status を failed に更新
    await sb.from('voice_notes')
      .update({ analysis_status: 'failed' })
      .eq('id', voiceNoteId)
      .then(() => { /* ignore cleanup error */ })

    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
