/**
 * bookingPrompt.ts
 * Booking Prompt サービス層。
 *
 * 来店前に Customer Notes / Voice Notes を集約し
 * スタッフへ「今日の接客ポイント」を生成・保存・取得する。
 *
 * 生成ロジック: deterministic ルールベース（LLM 未使用）。
 * 将来の差し替えポイント: generateBookingPrompt 内の TODO コメント箇所。
 */

import { supabase, DEMO_MODE, VOICE_NOTES_LIVE } from '@/lib/supabase'
import { prodLog } from '@/lib/stability'
import { fetchCustomerNotes } from '@/lib/customerNotes'
import { fetchVoiceNotes } from '@/lib/voiceNote'
import { INSIGHT_TAG_LABELS } from '@/types'
import type { BookingPrompt } from '@/types'

export type { BookingPrompt }

// ─── DEMO データ ──────────────────────────────────────────────────────────────

const DEMO_PROMPT: BookingPrompt = {
  id:                    'demo-bp-1',
  customer_id:           'demo',
  reservation_id:        null,
  store_id:              null,
  summary:               '乾燥と疲れが気になる様子。仕事が忙しく睡眠不足とのこと。娘さんの誕生日イベントに向けてお肌をきれいにしたいとのこと。',
  recommended_topics:    ['娘さんの誕生日', '仕事の繁忙期'],
  recommended_proposals: ['保湿強化', 'エイジングケア'],
  risk_flags:            ['乾燥', '疲れ'],
  confidence:            0.75,
  generated_at:          new Date().toISOString(),
  created_at:            new Date().toISOString(),
}

// ─── suggest_* タグ → 提案テキスト ───────────────────────────────────────────

const SUGGEST_PROPOSAL_MAP: Record<string, string> = {
  suggest_peel:      'ピーリング',
  suggest_whitening: '美白ケア',
  suggest_premium:   'プレミアムコース',
  suggest_homecare:  'ホームケア強化',
  suggest_rebook:    '早期再予約',
}

// ─── リスクキーワード ─────────────────────────────────────────────────────────

const RISK_KEYWORDS = [
  'アレルギー', '敏感肌', '敏感', '花粉症', '持病', 'お薬', '薬', '荒れやすい', '刺激',
]

const TAG_RISK_MAP: Record<string, string> = {
  sensitive_skin: '敏感肌',
  acne_concern:   'ニキビ注意',
  redness_concern:'赤み注意',
}

// ─── 取得 ─────────────────────────────────────────────────────────────────────

/**
 * 顧客の最新 Booking Prompt を取得。
 * reservation_id が指定された場合はその予約に紐づくものを優先し、
 * なければ顧客の最新を返す。
 */
export async function fetchBookingPrompt(
  customerId:    string,
  reservationId: string | null = null,
): Promise<BookingPrompt | null> {
  if (DEMO_MODE && !VOICE_NOTES_LIVE) return DEMO_PROMPT

  let query = supabase
    .from('booking_prompts')
    .select('*')
    .eq('customer_id', customerId)
    .order('generated_at', { ascending: false })
    .limit(1)

  if (reservationId) {
    // reservation 指定があれば絞り込む（なければ顧客最新で OK）
    const { data: exact } = await supabase
      .from('booking_prompts')
      .select('*')
      .eq('customer_id', customerId)
      .eq('reservation_id', reservationId)
      .order('generated_at', { ascending: false })
      .limit(1)

    if (exact && exact.length > 0) return exact[0] as BookingPrompt
    // reservation 紐づきがなければ顧客最新に fallback
  }

  const { data, error } = await query
  if (error) {
    prodLog('error', '[bookingPrompt] fetch failed', error.message)
    return null
  }
  return data && data.length > 0 ? (data[0] as BookingPrompt) : null
}

// ─── 生成 ─────────────────────────────────────────────────────────────────────

/**
 * Customer Notes・Voice Notes からルールベースで Booking Prompt を生成。
 * LLM 未使用。純粋関数ではなく Supabase を呼ぶため async。
 */
export async function generateBookingPrompt(
  customerId:    string,
  reservationId: string | null = null,
): Promise<Omit<BookingPrompt, 'id' | 'created_at'>> {
  // 1. データ取得（並列）
  const [notes, voiceNotes] = await Promise.all([
    fetchCustomerNotes(customerId),
    fetchVoiceNotes(customerId, 10),
  ])

  // 2. Voice Notes から insight_tags を集計
  const tagCounts: Record<string, number> = {}
  for (const vn of voiceNotes) {
    for (const tag of (vn.insight_tags ?? [])) {
      tagCounts[tag] = (tagCounts[tag] ?? 0) + 1
    }
  }
  const topTags = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag)

  // 3. summary 生成
  const healthNotes = notes.filter(n => n.category === 'Health').slice(0, 2)
  const prefNotes   = notes.filter(n => n.category === 'Preference').slice(0, 1)

  const summaryParts: string[] = []
  for (const hn of healthNotes) {
    summaryParts.push(truncate(hn.note, 40))
  }
  for (const pn of prefNotes) {
    summaryParts.push(truncate(pn.note, 30))
  }
  // タグ由来の補足
  if (topTags.includes('dryness_concern') && !summaryParts.some(s => s.includes('乾燥'))) {
    summaryParts.push('乾燥ケアへの関心が高い')
  }
  if (topTags.includes('aging_concern') && !summaryParts.some(s => s.includes('エイジング'))) {
    summaryParts.push('エイジングケアに意識的')
  }
  if (topTags.includes('busy_lifestyle') && !summaryParts.some(s => s.includes('忙し'))) {
    summaryParts.push('多忙なライフスタイル')
  }

  const summary = summaryParts.length > 0
    ? summaryParts.join('。') + '。'
    : notes.length > 0
      ? `${notes.length}件の会話記録あり。`
      : '接客記録を蓄積中です。'

  // 4. recommended_topics（Family + Event + Work → 話しかけるトピック）
  const topicNotes = [
    ...notes.filter(n => n.category === 'Event').slice(0, 2),
    ...notes.filter(n => n.category === 'Family').slice(0, 2),
    ...notes.filter(n => n.category === 'Work').slice(0, 1),
  ]
  const recommended_topics = topicNotes
    .map(n => cleanTopic(n.note))
    .filter(t => t.length >= 3)
    .slice(0, 5)

  // 5. recommended_proposals（suggest_* タグ + ノート内容から）
  const proposalSet = new Set<string>()
  for (const tag of topTags.filter(t => t.startsWith('suggest_'))) {
    const label = SUGGEST_PROPOSAL_MAP[tag]
    if (label) proposalSet.add(label)
  }
  // ノートテキストから追加
  const allNoteText = notes.map(n => n.note).join(' ')
  if (allNoteText.includes('乾燥') || allNoteText.includes('保湿')) proposalSet.add('保湿強化')
  if (allNoteText.includes('エイジング') || allNoteText.includes('シワ')) proposalSet.add('エイジングケア')
  if (allNoteText.includes('美白') || allNoteText.includes('シミ')) proposalSet.add('美白ケア')
  // Voice Note の next_suggestion（InsightGenerator 由来）
  for (const vn of voiceNotes) {
    const ns = (vn as unknown as Record<string, unknown>)['next_suggestion']
    if (typeof ns === 'string' && ns) proposalSet.add(ns)
  }
  const recommended_proposals = Array.from(proposalSet).slice(0, 4)

  // 6. risk_flags（Health ノート + 敏感系タグ）
  const riskSet = new Set<string>()
  for (const note of notes.filter(n => n.category === 'Health')) {
    for (const kw of RISK_KEYWORDS) {
      if (note.note.includes(kw)) riskSet.add(kw)
    }
  }
  for (const [tag, label] of Object.entries(TAG_RISK_MAP)) {
    if (topTags.includes(tag)) riskSet.add(label)
  }
  const risk_flags = Array.from(riskSet).slice(0, 5)

  // 7. confidence（データ量 → 0.4〜0.95）
  const completedVoice = voiceNotes.filter(v => v.analysis_status === 'completed').length
  const rawConf = 0.4 + (notes.length * 0.04) + (completedVoice * 0.06)
  const confidence = Math.round(Math.min(0.95, rawConf) * 1000) / 1000

  return {
    customer_id:            customerId,
    reservation_id:         reservationId,
    store_id:               null,
    summary,
    recommended_topics,
    recommended_proposals,
    risk_flags,
    confidence,
    generated_at:           new Date().toISOString(),
  }
}

// ─── 保存（UPSERT） ───────────────────────────────────────────────────────────

/**
 * Booking Prompt を保存。
 * 同じ customer_id + reservation_id が存在する場合は UPDATE、なければ INSERT。
 */
export async function saveBookingPrompt(
  prompt: Omit<BookingPrompt, 'id' | 'created_at'>,
): Promise<BookingPrompt | null> {
  if (DEMO_MODE && !VOICE_NOTES_LIVE) return null

  const { customer_id, reservation_id } = prompt

  // 既存レコードを確認
  let existingId: string | null = null
  if (reservation_id) {
    const { data } = await supabase
      .from('booking_prompts')
      .select('id')
      .eq('customer_id', customer_id)
      .eq('reservation_id', reservation_id)
      .limit(1)
    if (data && data.length > 0) existingId = data[0].id as string
  } else {
    const { data } = await supabase
      .from('booking_prompts')
      .select('id')
      .eq('customer_id', customer_id)
      .is('reservation_id', null)
      .order('created_at', { ascending: false })
      .limit(1)
    if (data && data.length > 0) existingId = data[0].id as string
  }

  if (existingId) {
    // UPDATE
    const { data, error } = await supabase
      .from('booking_prompts')
      .update({
        summary:               prompt.summary,
        recommended_topics:    prompt.recommended_topics,
        recommended_proposals: prompt.recommended_proposals,
        risk_flags:            prompt.risk_flags,
        confidence:            prompt.confidence,
        generated_at:          prompt.generated_at,
      })
      .eq('id', existingId)
      .select('*')
      .single()

    if (error) { prodLog('error', '[bookingPrompt] update failed', error.message); return null }
    prodLog('info', '[bookingPrompt] updated', existingId)
    return data as BookingPrompt
  } else {
    // INSERT
    const { data, error } = await supabase
      .from('booking_prompts')
      .insert(prompt)
      .select('*')
      .single()

    if (error) { prodLog('error', '[bookingPrompt] insert failed', error.message); return null }
    prodLog('info', '[bookingPrompt] inserted', data.id)
    return data as BookingPrompt
  }
}

// ─── ヘルパー ─────────────────────────────────────────────────────────────────

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max)
}

function cleanTopic(note: string): string {
  return note
    .replace(/とのことでした.*/, '')
    .replace(/について.*/, '')
    .replace(/と話していた.*/, '')
    .replace(/とのこと.*/, '')
    .trim()
    .slice(0, 20)
}

// ─── 生成 + 保存 ワンショット ─────────────────────────────────────────────────

export async function generateAndSave(
  customerId:    string,
  reservationId: string | null = null,
): Promise<BookingPrompt | null> {
  try {
    const prompt = await generateBookingPrompt(customerId, reservationId)
    return await saveBookingPrompt(prompt)
  } catch (e) {
    prodLog('error', '[bookingPrompt] generateAndSave failed', e)
    return null
  }
}
