/**
 * contraindication.ts
 * Contraindication AI サービス層。
 *
 * 顧客の会話内容・顧客ノートから施術禁忌・注意事項を自動抽出し保存する。
 * 生成ロジック: ルールベース（キーワード辞書方式、LLM 未使用）。
 *
 * 重複判定: customer_id + title の組み合わせで UPDATE / INSERT を切り替える。
 */

import { supabase, DEMO_MODE, VOICE_NOTES_LIVE } from '@/lib/supabase'
import { prodLog } from '@/lib/stability'
import { fetchCustomerNotes } from '@/lib/customerNotes'
import { fetchVoiceNotes } from '@/lib/voiceNote'
import type { Contraindication, ContraindicationSeverity } from '@/types'

export type { Contraindication }

// ─── DEMO データ ──────────────────────────────────────────────────────────────

const DEMO_CONTRAINDICATIONS: Contraindication[] = [
  {
    id:             'demo-ci-1',
    customer_id:    'demo',
    reservation_id: null,
    store_id:       null,
    severity:       'MEDIUM',
    title:          '敏感肌',
    description:    '刺激に弱く、施術後に赤みが出やすい傾向あり',
    recommendation: '出力レベルを弱めに設定。パッチテスト推奨',
    source:         'customer_notes',
    source_note_id: null,
    confidence:     0.85,
    generated_at:   new Date().toISOString(),
    created_at:     new Date().toISOString(),
  },
  {
    id:             'demo-ci-2',
    customer_id:    'demo',
    reservation_id: null,
    store_id:       null,
    severity:       'LOW',
    title:          '乾燥肌',
    description:    '乾燥が強く、バリア機能が低下している可能性あり',
    recommendation: '施術前後に保湿ケアを強化',
    source:         'customer_notes',
    source_note_id: null,
    confidence:     0.80,
    generated_at:   new Date().toISOString(),
    created_at:     new Date().toISOString(),
  },
]

// ─── キーワード辞書 ───────────────────────────────────────────────────────────

interface ContraindicationRule {
  keywords:       string[]
  severity:       ContraindicationSeverity
  title:          string
  description:    string
  recommendation: string
}

const CONTRAINDICATION_RULES: ContraindicationRule[] = [
  // ── CRITICAL ──────────────────────────────────────────────────────────────
  {
    keywords:       ['感染症', '感染中', '皮膚感染', 'ウイルス', '帯状疱疹', 'ヘルペス'],
    severity:       'CRITICAL',
    title:          '感染症の疑い',
    description:    '感染症治療中または感染症の疑いがある',
    recommendation: '施術を一時中止し、医師の許可確認後に再開',
  },
  {
    keywords:       ['抗がん剤', '化学療法', '放射線治療', '放射線'],
    severity:       'CRITICAL',
    title:          '抗がん剤・放射線治療中',
    description:    '抗がん剤または放射線治療中のため皮膚が脆弱',
    recommendation: '主治医への確認必須。施術禁止の可能性が高い',
  },
  // ── HIGH ──────────────────────────────────────────────────────────────────
  {
    keywords:       ['妊娠', '妊娠中', '妊婦', 'マタニティ', '妊娠している'],
    severity:       'HIGH',
    title:          '妊娠中',
    description:    '妊娠中のため一部施術は禁忌',
    recommendation: '施術メニュー確認・妊娠週数確認。医師への確認推奨',
  },
  {
    keywords:       ['授乳中', '授乳', '母乳'],
    severity:       'HIGH',
    title:          '授乳中',
    description:    '授乳中のため成分が母乳に影響する可能性',
    recommendation: '使用成分の確認。施術内容により要注意',
  },
  {
    keywords:       ['レーザー直後', 'レーザー後', 'レーザー施術後'],
    severity:       'HIGH',
    title:          '直近レーザー施術後',
    description:    'レーザー施術直後のため皮膚が敏感な状態',
    recommendation: '施術間隔の確認（最低2〜4週間）',
  },
  {
    keywords:       ['美容施術直後', '施術直後', '直後に来店'],
    severity:       'HIGH',
    title:          '他院施術直後',
    description:    '他院での美容施術直後のため皮膚が回復途中',
    recommendation: '施術内容と経過日数の確認',
  },
  {
    keywords:       ['持病', '持病あり', '疾患', '治療中', '通院中'],
    severity:       'HIGH',
    title:          '持病・疾患治療中',
    description:    '何らかの疾患で治療中',
    recommendation: '施術可否の確認。必要に応じて医師への相談促進',
  },
  {
    keywords:       ['薬', 'お薬', '服薬', 'ステロイド', 'ワーファリン', '血液サラサラ'],
    severity:       'HIGH',
    title:          '服薬中',
    description:    '薬を服用中のため施術への影響が懸念される',
    recommendation: '服用薬の確認。光感作性薬剤は特に要注意',
  },
  // ── MEDIUM ────────────────────────────────────────────────────────────────
  {
    keywords:       ['アレルギー', 'アレルギー体質', '金属アレルギー', 'ラテックスアレルギー'],
    severity:       'MEDIUM',
    title:          'アレルギー',
    description:    'アレルギー体質または特定物質へのアレルギーあり',
    recommendation: '使用製品・機器の成分確認。パッチテスト推奨',
  },
  {
    keywords:       ['アトピー', 'アトピー性皮膚炎'],
    severity:       'MEDIUM',
    title:          'アトピー性皮膚炎',
    description:    'アトピー性皮膚炎のため皮膚バリアが低下',
    recommendation: '症状安定期のみ施術可。出力を弱めに設定',
  },
  {
    keywords:       ['花粉症', '季節性アレルギー'],
    severity:       'MEDIUM',
    title:          '花粉症・季節性アレルギー',
    description:    '花粉症などの季節性アレルギーにより皮膚が敏感',
    recommendation: 'シーズン中は反応性が高い。施術強度を調整',
  },
  {
    keywords:       ['炎症', '炎症中', 'ニキビ炎症', '肌荒れ中'],
    severity:       'MEDIUM',
    title:          '現在炎症あり',
    description:    '施術部位またはその周辺に炎症がある',
    recommendation: '炎症部位を避けて施術。炎症が治まるまで一部施術を延期推奨',
  },
  {
    keywords:       ['敏感肌', '肌が敏感', '敏感', '刺激に弱い'],
    severity:       'MEDIUM',
    title:          '敏感肌',
    description:    '肌が敏感で刺激に反応しやすい',
    recommendation: '出力レベルを弱めに設定。パッチテスト実施',
  },
  // ── LOW ───────────────────────────────────────────────────────────────────
  {
    keywords:       ['乾燥肌', '乾燥が強い', '乾燥する', '乾燥がひどい', '砂漠肌'],
    severity:       'LOW',
    title:          '乾燥肌',
    description:    '乾燥が強くバリア機能が低下している可能性',
    recommendation: '施術前後に保湿ケアを強化。保湿成分配合の製品優先',
  },
  {
    keywords:       ['赤みが出やすい', '赤くなりやすい', '赤み', '顔が赤くなる'],
    severity:       'LOW',
    title:          '赤みが出やすい',
    description:    '施術後に赤みが出やすい傾向がある',
    recommendation: '施術後の冷却・鎮静ケアを強化',
  },
  {
    keywords:       ['日焼け', '日焼け後', '日焼けした', '紫外線'],
    severity:       'LOW',
    title:          '日焼け後',
    description:    '直近で日焼けをしている可能性',
    recommendation: '日焼け部位への施術は強度を下げる。紫外線対策を徹底',
  },
]

// ─── 取得 ─────────────────────────────────────────────────────────────────────

export async function fetchContraindications(
  customerId: string,
): Promise<Contraindication[]> {
  if (DEMO_MODE && !VOICE_NOTES_LIVE) return DEMO_CONTRAINDICATIONS

  const { data, error } = await supabase
    .from('contraindications')
    .select('*')
    .eq('customer_id', customerId)
    .order('generated_at', { ascending: false })

  if (error) {
    prodLog('error', '[contraindication] fetch failed', error.message)
    return []
  }
  return (data ?? []) as Contraindication[]
}

// ─── 生成 ─────────────────────────────────────────────────────────────────────

interface GeneratedContraindication {
  severity:        ContraindicationSeverity
  title:           string
  description:     string
  recommendation:  string
  source:          string
  source_note_id:  string | null
  confidence:      number
}

/**
 * customer_notes / voice_notes / handover から禁忌・注意事項を生成。
 * ルールベースのキーワードマッチング。
 */
export async function generateContraindications(
  customerId: string,
): Promise<GeneratedContraindication[]> {

  // 並列取得
  const [notes, voiceNotes] = await Promise.all([
    fetchCustomerNotes(customerId),
    fetchVoiceNotes(customerId, 10),
  ])

  // 検索対象テキストを収集
  const searchTargets: Array<{ text: string; source: string; noteId: string | null }> = []

  for (const note of notes) {
    searchTargets.push({
      text:   note.note,
      source: 'customer_notes',
      noteId: note.id,
    })
  }

  for (const vn of voiceNotes) {
    const text = [vn.transcript, vn.summary].filter(Boolean).join(' ')
    if (text.length >= 5) {
      searchTargets.push({
        text,
        source: 'voice_notes',
        noteId: vn.id,
      })
    }
    // insight_tags から直接キーワード生成
    for (const tag of (vn.insight_tags ?? [])) {
      if (tag === 'sensitive_skin') {
        searchTargets.push({ text: '敏感肌', source: 'voice_notes', noteId: vn.id })
      }
      if (tag === 'acne_concern') {
        searchTargets.push({ text: '炎症', source: 'voice_notes', noteId: vn.id })
      }
      if (tag === 'redness_concern') {
        searchTargets.push({ text: '赤みが出やすい', source: 'voice_notes', noteId: vn.id })
      }
      if (tag === 'dryness_concern') {
        searchTargets.push({ text: '乾燥肌', source: 'voice_notes', noteId: vn.id })
      }
    }
  }

  // キーワードマッチング
  const found = new Map<string, GeneratedContraindication>()

  for (const target of searchTargets) {
    for (const rule of CONTRAINDICATION_RULES) {
      if (found.has(rule.title)) continue  // 重複スキップ（最初のソース優先）
      const matched = rule.keywords.some(kw => target.text.includes(kw))
      if (!matched) continue

      // confidence: CRITICAL=0.95, HIGH=0.88, MEDIUM=0.80, LOW=0.72
      const confidenceMap: Record<ContraindicationSeverity, number> = {
        CRITICAL: 0.95, HIGH: 0.88, MEDIUM: 0.80, LOW: 0.72,
      }

      found.set(rule.title, {
        severity:       rule.severity,
        title:          rule.title,
        description:    rule.description,
        recommendation: rule.recommendation,
        source:         target.source,
        source_note_id: target.noteId,
        confidence:     confidenceMap[rule.severity],
      })
    }
  }

  // severity 順でソート（CRITICAL → HIGH → MEDIUM → LOW）
  const ORDER: Record<ContraindicationSeverity, number> = {
    CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3,
  }

  return Array.from(found.values())
    .sort((a, b) => ORDER[a.severity] - ORDER[b.severity])
}

// ─── 保存（重複防止：customer_id + title で判定） ────────────────────────────

export async function saveContraindications(
  customerId:    string,
  reservationId: string | null,
  items:         GeneratedContraindication[],
): Promise<Contraindication[]> {
  if (DEMO_MODE && !VOICE_NOTES_LIVE) return []
  if (items.length === 0) return []

  // 既存レコードを title キーで取得
  const { data: existing } = await supabase
    .from('contraindications')
    .select('id, title')
    .eq('customer_id', customerId)

  const existingMap = new Map<string, string>(
    (existing ?? []).map((r: { id: string; title: string }) => [r.title, r.id])
  )

  const saved: Contraindication[] = []
  const now = new Date().toISOString()

  for (const item of items) {
    const existingId = existingMap.get(item.title)

    if (existingId) {
      // UPDATE
      const { data, error } = await supabase
        .from('contraindications')
        .update({
          severity:       item.severity,
          description:    item.description,
          recommendation: item.recommendation,
          source:         item.source,
          source_note_id: item.source_note_id,
          confidence:     item.confidence,
          generated_at:   now,
          reservation_id: reservationId,
        })
        .eq('id', existingId)
        .select('*')
        .single()
      if (error) { prodLog('error', '[contraindication] update failed', error.message) }
      else if (data) saved.push(data as Contraindication)
    } else {
      // INSERT
      const { data, error } = await supabase
        .from('contraindications')
        .insert({
          customer_id:    customerId,
          reservation_id: reservationId,
          store_id:       null,
          severity:       item.severity,
          title:          item.title,
          description:    item.description,
          recommendation: item.recommendation,
          source:         item.source,
          source_note_id: item.source_note_id,
          confidence:     item.confidence,
          generated_at:   now,
        })
        .select('*')
        .single()
      if (error) { prodLog('error', '[contraindication] insert failed', error.message) }
      else if (data) saved.push(data as Contraindication)
    }
  }

  prodLog('info', `[contraindication] ${saved.length}件 保存完了`)
  return saved
}

// ─── 生成 + 保存 ワンショット ─────────────────────────────────────────────────

export async function generateAndSaveContraindications(
  customerId:    string,
  reservationId: string | null = null,
): Promise<Contraindication[]> {
  try {
    const items = await generateContraindications(customerId)
    if (items.length === 0) return []
    return await saveContraindications(customerId, reservationId, items)
  } catch (e) {
    prodLog('error', '[contraindication] generateAndSave failed', e)
    return []
  }
}
