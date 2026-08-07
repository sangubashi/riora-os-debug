/**
 * analyzeKarteText.ts — Salon Boardカルテ原文 → Claude抽出（DB非接触）
 *
 * 設計: docs/CALTE_IMPORT_MVP_DESIGN.md §2
 *   【鉄則】このモジュールはDBへ一切書き込まない。抽出候補を返すだけで、
 *   保存は必ず別モジュール(commitKarteImport.ts、スタッフの確認・選択を経てから)
 *   が担う。抽出のみを行い、原文にない情報を創作しない・誇張しないことを
 *   プロンプトで明示的に指示する。
 *
 * 呼び出し方式は既存の homecare-message route と同一（生fetch、SDK不使用、
 * claude-haiku-4-5-20251001）。
 */
import type {
  KarteExtractionResult,
  KarteTextCandidate,
  KarteContraindicationCandidate,
} from '@/types/karteImport'
import type { ContraindicationSeverity } from '@/types'

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY

const SEVERITIES: ContraindicationSeverity[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']

const SYSTEM_PROMPT = `あなたは高級美容サロンのカルテ記録を整理するアシスタントです。
スタッフが貼り付けたカルテ文章から、以下の6項目のみを抽出してください。

抽出対象:
- treatments: 施術内容（行った施術・使用した機器や製品）
- skinCondition: 肌状態（観察された肌の状態）
- concerns: 悩み（顧客本人が語った悩み・要望）
- precautions: 注意事項（禁忌には至らないが配慮すべき事項）
- contraindications: 禁忌事項（今後の施術で明確に避けるべき医学的理由があるもののみ。
  一般的な気遣い事項はprecautionsに分類し、ここには入れないこと）
- nextProposalCandidates: 次回来店時に提案できそうな内容（次回提案の参考メモであり、
  確定した提案ではない）

厳守事項:
- 原文に書かれていない情報を創作・推測で補わないこと
- 誇張や言い換えによる意味の変更をしないこと
- 該当する記述がない項目は空配列にすること
- contraindicationsの各項目には title・description・severity(LOW/MEDIUM/HIGH/CRITICALのいずれか)を必ず付けること
- visitDate（施術日と読み取れる日付があれば ISO 8601形式の文字列、無ければnull）も返すこと
- 出力は以下のJSON形式のみ。前置き・説明文・Markdown装飾は一切不要:

{
  "treatments": [{"content": "string"}],
  "skinCondition": [{"content": "string"}],
  "concerns": [{"content": "string"}],
  "precautions": [{"content": "string"}],
  "contraindications": [{"title": "string", "description": "string", "severity": "LOW"}],
  "nextProposalCandidates": [{"content": "string"}],
  "visitDate": null
}`

export type AnalyzeKarteTextResult =
  | { ok: true; extracted: KarteExtractionResult }
  | { ok: false; reason: string }

interface RawClaudeExtraction {
  treatments?:              Array<{ content?: string }>
  skinCondition?:           Array<{ content?: string }>
  concerns?:                Array<{ content?: string }>
  precautions?:             Array<{ content?: string }>
  contraindications?:       Array<{ title?: string; description?: string; severity?: string }>
  nextProposalCandidates?:  Array<{ content?: string }>
  visitDate?:               string | null
}

function toTextCandidates(items: Array<{ content?: string }> | undefined): KarteTextCandidate[] {
  return (items ?? [])
    .map(i => ({ content: (i.content ?? '').trim() }))
    .filter(i => i.content.length > 0)
}

function toContraindicationCandidates(
  items: RawClaudeExtraction['contraindications']
): KarteContraindicationCandidate[] {
  return (items ?? [])
    .filter((i): i is { title: string; description: string; severity: string } =>
      typeof i.title === 'string' && i.title.trim().length > 0)
    .map(i => ({
      title:       i.title.trim(),
      description: (i.description ?? '').trim(),
      severity:    SEVERITIES.includes(i.severity as ContraindicationSeverity)
        ? (i.severity as ContraindicationSeverity)
        : 'MEDIUM',
    }))
}

export async function analyzeKarteText(rawText: string): Promise<AnalyzeKarteTextResult> {
  const trimmed = rawText.trim()
  if (trimmed.length < 5) {
    return { ok: false, reason: 'text_too_short' }
  }
  if (!ANTHROPIC_KEY) {
    return { ok: false, reason: 'anthropic_key_not_configured' }
  }

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
        max_tokens: 2048,
        system:     SYSTEM_PROMPT,
        messages:   [{ role: 'user', content: `カルテ原文:\n${trimmed}` }],
      }),
    })

    if (!res.ok) {
      return { ok: false, reason: `claude_api_error:${res.status}` }
    }

    const j   = await res.json() as { content: Array<{ type: string; text: string }> }
    const raw  = j.content?.[0]?.text ?? ''
    const m    = raw.match(/\{[\s\S]*\}/)
    if (!m) {
      return { ok: false, reason: 'no_json_in_response' }
    }

    const parsed = JSON.parse(m[0]) as RawClaudeExtraction

    const extracted: KarteExtractionResult = {
      treatments:              toTextCandidates(parsed.treatments),
      skinCondition:           toTextCandidates(parsed.skinCondition),
      concerns:                toTextCandidates(parsed.concerns),
      precautions:             toTextCandidates(parsed.precautions),
      contraindications:       toContraindicationCandidates(parsed.contraindications),
      nextProposalCandidates:  toTextCandidates(parsed.nextProposalCandidates),
      visitDateGuess:          typeof parsed.visitDate === 'string' ? parsed.visitDate : null,
    }

    return { ok: true, extracted }
  } catch {
    return { ok: false, reason: 'analysis_exception' }
  }
}
