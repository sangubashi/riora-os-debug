/**
 * update-ai-tags – Supabase Edge Function
 * Classifies a short staff log into AI tags using Claude Haiku.
 * Max 100 tokens output. Updates the ai_tags table.
 *
 * Input:  { customer_id: string, log_text: string }
 * Output: { success: boolean, tags: string[] }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Deno-compatible Anthropic client (using fetch directly for Edge Function environment)
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'

interface RequestBody {
  customer_id: string
  log_text: string
}

interface TagResult {
  tags: string[]
  dry_skin?: boolean
  uv_sensitive?: boolean
  sales_hate?: boolean
  vip?: boolean
  repeat_high?: boolean
}

const VALID_TAGS = ['dry_skin', 'uv_sensitive', 'sales_hate', 'vip', 'repeat_high'] as const
type ValidTag = typeof VALID_TAGS[number]

function corsHeaders(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') ?? '*'

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    })
  }

  try {
    const body: RequestBody = await req.json()
    const { customer_id, log_text } = body

    if (!customer_id || !log_text) {
      return new Response(
        JSON.stringify({ error: 'customer_id and log_text are required' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
        }
      )
    }

    // ─── Call Claude Haiku for tag classification ──────────────────────────

    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicKey) {
      throw new Error('ANTHROPIC_API_KEY is not configured')
    }

    const prompt = `この接客メモから当てはまるタグを選んでJSON返してください: dry_skin, uv_sensitive, sales_hate, vip, repeat_high\nメモ: ${log_text}\n返答: {"tags": [...]}`

    const anthropicResponse = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 100,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    })

    if (!anthropicResponse.ok) {
      const errText = await anthropicResponse.text()
      throw new Error(`Anthropic API error: ${anthropicResponse.status} – ${errText}`)
    }

    const anthropicData = await anthropicResponse.json()
    const rawText: string = anthropicData?.content?.[0]?.text ?? '{"tags":[]}'

    // Parse the JSON response from Haiku
    let parsedTags: string[] = []
    try {
      // Extract JSON from the response (Haiku may wrap it in extra text)
      const jsonMatch = rawText.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed: TagResult = JSON.parse(jsonMatch[0])
        parsedTags = Array.isArray(parsed.tags) ? parsed.tags : []
      }
    } catch {
      parsedTags = []
    }

    // Validate tags against the allowed set
    const validatedTags = parsedTags.filter((t): t is ValidTag =>
      VALID_TAGS.includes(t as ValidTag)
    )

    // Build boolean columns from tags
    const tagBooleans: Record<ValidTag, boolean> = {
      dry_skin:     validatedTags.includes('dry_skin'),
      uv_sensitive: validatedTags.includes('uv_sensitive'),
      sales_hate:   validatedTags.includes('sales_hate'),
      vip:          validatedTags.includes('vip'),
      repeat_high:  validatedTags.includes('repeat_high'),
    }

    // ─── Upsert into ai_tags ──────────────────────────────────────────────

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    })

    const { error: upsertError } = await supabase
      .from('ai_tags')
      .upsert(
        {
          customer_id,
          tags: validatedTags,
          ...tagBooleans,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'customer_id' }
      )

    if (upsertError) {
      throw new Error(`Failed to upsert ai_tags: ${upsertError.message}`)
    }

    return new Response(
      JSON.stringify({ success: true, tags: validatedTags }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      }
    )
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Internal server error'
    return new Response(
      JSON.stringify({ success: false, error: message }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      }
    )
  }
})
