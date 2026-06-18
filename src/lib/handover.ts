/**
 * handover.ts
 * AI Handover サービス層。
 *
 * 担当スタッフ変更時・複数スタッフ運用時に、
 * customer_notes / booking_prompts / voice_notes / customer_action_logs を集約し
 * 「引継ぎノート」を自動生成・保存・取得する。
 *
 * 生成ロジック: deterministic ルールベース（LLM 未使用）。
 */

import { supabase, DEMO_MODE, VOICE_NOTES_LIVE } from '@/lib/supabase'
import { prodLog } from '@/lib/stability'
import { fetchCustomerNotes } from '@/lib/customerNotes'
import { fetchVoiceNotes } from '@/lib/voiceNote'
import type { HandoverNote } from '@/types'

export type { HandoverNote }

// ─── DEMO データ ──────────────────────────────────────────────────────────────

const DEMO_HANDOVER: HandoverNote = {
  id:                  'demo-hn-1',
  customer_id:         'demo',
  reservation_id:      null,
  store_id:            null,
  summary:             '乾燥改善目的で継続来店中。敏感肌傾向あり。LDM施術継続中。',
  customer_context:    ['娘さん受験中', '来月ハワイ旅行', '経営者・多忙'],
  open_tasks:          ['LDM継続提案中', 'ホームケア説明未実施', '次回来店予約確認'],
  recommended_actions: ['旅行前の保湿強化提案', '幹細胞導入提案', 'ホームケア確認'],
  risk_flags:          ['敏感肌', '乾燥'],
  confidence:          0.72,
  generated_at:        new Date().toISOString(),
  created_at:          new Date().toISOString(),
}

// ─── リスクキーワード ─────────────────────────────────────────────────────────

const HEALTH_RISK_KEYWORDS = [
  'アレルギー', '敏感肌', '敏感', '花粉症', '持病', 'お薬', '薬',
  '荒れやすい', '刺激', '赤み', 'ニキビ', '乾燥',
]

// action_type → open_task テキスト（未完了判定用）
const PENDING_TASK_LABELS: Record<string, string> = {
  homecare_explained:  'ホームケア説明未実施',
  rebook_recommended:  '次回来店予約確認',
  product_recommended: '商品提案フォロー中',
  suggest_peel:        'ピーリング提案フォロー',
  suggest_premium:     'プレミアムコース提案中',
}

// ─── 取得 ─────────────────────────────────────────────────────────────────────

/**
 * 顧客の最新 HandoverNote を取得。
 * reservation_id が指定された場合はそちらを優先し、なければ顧客最新を返す。
 */
export async function fetchHandover(
  customerId:    string,
  reservationId: string | null = null,
): Promise<HandoverNote | null> {
  if (DEMO_MODE && !VOICE_NOTES_LIVE) return DEMO_HANDOVER

  if (reservationId) {
    const { data: exact } = await supabase
      .from('handover_notes')
      .select('*')
      .eq('customer_id', customerId)
      .eq('reservation_id', reservationId)
      .order('generated_at', { ascending: false })
      .limit(1)
    if (exact && exact.length > 0) return exact[0] as HandoverNote
  }

  const { data, error } = await supabase
    .from('handover_notes')
    .select('*')
    .eq('customer_id', customerId)
    .order('generated_at', { ascending: false })
    .limit(1)

  if (error) {
    prodLog('error', '[handover] fetch failed', error.message)
    return null
  }
  return data && data.length > 0 ? (data[0] as HandoverNote) : null
}

// ─── 生成 ─────────────────────────────────────────────────────────────────────

/**
 * customer_notes / voice_notes / action_logs から引継ぎノートを生成。
 */
export async function generateHandover(
  customerId:    string,
  reservationId: string | null = null,
): Promise<Omit<HandoverNote, 'id' | 'created_at'>> {

  // 1. データ並列取得
  const [notes, voiceNotes] = await Promise.all([
    fetchCustomerNotes(customerId),
    fetchVoiceNotes(customerId, 10),
  ])

  // action_logs は Supabase から直接取得（DEMO_MODE 対応）
  let recentActionTypes: string[] = []
  if (!DEMO_MODE || VOICE_NOTES_LIVE) {
    const { data: logs } = await supabase
      .from('customer_action_logs')
      .select('action_type')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(20)
    recentActionTypes = (logs ?? []).map((l: { action_type: string }) => l.action_type)
  }

  // 2. Voice Notes タグ集計
  const tagCounts: Record<string, number> = {}
  for (const vn of voiceNotes) {
    for (const tag of (vn.insight_tags ?? [])) {
      tagCounts[tag] = (tagCounts[tag] ?? 0) + 1
    }
  }
  const topTags = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag)

  // 3. summary（Health + Preference notes + タグ由来）
  const healthNotes = notes.filter(n => n.category === 'Health').slice(0, 2)
  const prefNotes   = notes.filter(n => n.category === 'Preference').slice(0, 1)

  const summaryParts: string[] = []
  for (const n of healthNotes) summaryParts.push(n.note.slice(0, 40))
  for (const n of prefNotes)   summaryParts.push(n.note.slice(0, 30))

  if (topTags.includes('dryness_concern') && !summaryParts.some(s => s.includes('乾燥'))) {
    summaryParts.push('乾燥ケアへの関心が高い')
  }
  if (topTags.includes('aging_concern') && !summaryParts.some(s => s.includes('エイジング'))) {
    summaryParts.push('エイジングケアに意識的')
  }
  if (topTags.includes('sensitive_skin') && !summaryParts.some(s => s.includes('敏感肌'))) {
    summaryParts.push('敏感肌傾向あり')
  }

  const completedVoice = voiceNotes.filter(v => v.analysis_status === 'completed').length
  const summary = summaryParts.length > 0
    ? summaryParts.join('。') + '。'
    : notes.length > 0
      ? `${notes.length}件の会話記録あり。`
      : '接客記録を蓄積中です。'

  // 4. customer_context（Family + Event + Work）
  const contextNotes = [
    ...notes.filter(n => n.category === 'Family').slice(0, 2),
    ...notes.filter(n => n.category === 'Event').slice(0, 2),
    ...notes.filter(n => n.category === 'Work').slice(0, 1),
  ]
  const customer_context = contextNotes
    .map(n => n.note
      .replace(/とのことでした.*/, '')
      .replace(/について.*/, '')
      .replace(/と話していた.*/, '')
      .replace(/とのこと.*/, '')
      .trim()
      .slice(0, 25)
    )
    .filter(t => t.length >= 3)
    .slice(0, 5)

  // 5. open_tasks（未完了アクション → 引継ぎ事項）
  const open_tasks: string[] = []
  const doneTypes = new Set(recentActionTypes)

  // 音声メモ → suggest_* タグが出ているが対応アクションが未記録のもの
  for (const tag of topTags.filter(t => t.startsWith('suggest_'))) {
    const label = PENDING_TASK_LABELS[tag]
    if (label && !open_tasks.includes(label)) open_tasks.push(label)
  }
  // よく未完了になるアクション
  for (const [actionType, label] of Object.entries(PENDING_TASK_LABELS)) {
    if (!doneTypes.has(actionType) && !open_tasks.includes(label)) {
      open_tasks.push(label)
    }
  }
  if (open_tasks.length === 0) open_tasks.push('引継ぎ事項なし')

  // 6. recommended_actions（タグ + ノート内容から生成）
  const actionSet = new Set<string>()
  const allNoteText = notes.map(n => n.note).join(' ')

  if (allNoteText.includes('旅行') || notes.some(n => n.category === 'Event')) {
    actionSet.add('旅行前の保湿強化提案')
  }
  if (allNoteText.includes('乾燥') || allNoteText.includes('保湿') || topTags.includes('dryness_concern')) {
    actionSet.add('保湿ケア強化提案')
  }
  if (allNoteText.includes('エイジング') || allNoteText.includes('シワ') || topTags.includes('aging_concern')) {
    actionSet.add('エイジングケア提案')
  }
  if (allNoteText.includes('美白') || allNoteText.includes('シミ')) {
    actionSet.add('美白ケア提案')
  }
  if (topTags.includes('suggest_premium')) actionSet.add('プレミアムコース提案')
  if (topTags.includes('suggest_homecare') || !doneTypes.has('homecare_explained')) {
    actionSet.add('ホームケア確認')
  }
  if (!doneTypes.has('rebook_recommended')) actionSet.add('次回予約促進')

  const recommended_actions = Array.from(actionSet).slice(0, 5)

  // 7. risk_flags（Health ノート + 敏感系タグ）
  const riskSet = new Set<string>()
  for (const note of notes.filter(n => n.category === 'Health')) {
    for (const kw of HEALTH_RISK_KEYWORDS) {
      if (note.note.includes(kw)) riskSet.add(kw)
    }
  }
  if (topTags.includes('sensitive_skin')) riskSet.add('敏感肌')
  if (topTags.includes('acne_concern'))   riskSet.add('ニキビ注意')
  if (topTags.includes('redness_concern')) riskSet.add('赤み注意')
  const risk_flags = Array.from(riskSet).slice(0, 5)

  // 8. confidence（データ量 → 0.4〜0.95）
  const rawConf = 0.35 + (notes.length * 0.04) + (completedVoice * 0.06)
  const confidence = Math.round(Math.min(0.95, rawConf) * 1000) / 1000

  return {
    customer_id:         customerId,
    reservation_id:      reservationId,
    store_id:            null,
    summary,
    customer_context,
    open_tasks:          open_tasks.slice(0, 5),
    recommended_actions,
    risk_flags,
    confidence,
    generated_at:        new Date().toISOString(),
  }
}

// ─── 保存（UPSERT） ───────────────────────────────────────────────────────────

/**
 * HandoverNote を保存。
 * 同じ customer_id + reservation_id が存在する場合は UPDATE、なければ INSERT。
 */
export async function saveHandover(
  note: Omit<HandoverNote, 'id' | 'created_at'>,
): Promise<HandoverNote | null> {
  if (DEMO_MODE && !VOICE_NOTES_LIVE) return null

  const { customer_id, reservation_id } = note

  // 既存レコードを確認
  let existingId: string | null = null
  if (reservation_id) {
    const { data } = await supabase
      .from('handover_notes')
      .select('id')
      .eq('customer_id', customer_id)
      .eq('reservation_id', reservation_id)
      .limit(1)
    if (data && data.length > 0) existingId = data[0].id as string
  } else {
    const { data } = await supabase
      .from('handover_notes')
      .select('id')
      .eq('customer_id', customer_id)
      .is('reservation_id', null)
      .order('created_at', { ascending: false })
      .limit(1)
    if (data && data.length > 0) existingId = data[0].id as string
  }

  if (existingId) {
    const { data, error } = await supabase
      .from('handover_notes')
      .update({
        summary:             note.summary,
        customer_context:    note.customer_context,
        open_tasks:          note.open_tasks,
        recommended_actions: note.recommended_actions,
        risk_flags:          note.risk_flags,
        confidence:          note.confidence,
        generated_at:        note.generated_at,
      })
      .eq('id', existingId)
      .select('*')
      .single()

    if (error) { prodLog('error', '[handover] update failed', error.message); return null }
    prodLog('info', '[handover] updated', existingId)
    return data as HandoverNote
  } else {
    const { data, error } = await supabase
      .from('handover_notes')
      .insert(note)
      .select('*')
      .single()

    if (error) { prodLog('error', '[handover] insert failed', error.message); return null }
    prodLog('info', '[handover] inserted', data.id)
    return data as HandoverNote
  }
}

// ─── 生成 + 保存 ワンショット ─────────────────────────────────────────────────

export async function generateAndSaveHandover(
  customerId:    string,
  reservationId: string | null = null,
): Promise<HandoverNote | null> {
  try {
    const note = await generateHandover(customerId, reservationId)
    return await saveHandover(note)
  } catch (e) {
    prodLog('error', '[handover] generateAndSave failed', e)
    return null
  }
}
