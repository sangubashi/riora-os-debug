/**
 * ruleBasedSuggestion.ts – Rule-based suggestion engine
 * NO full AI generation. Uses tag-to-rule mapping and template strings.
 * Only naturalizeLastLine() makes a single Claude Haiku call (last line only).
 */
import type { AiTagRow } from '@/types/database'

// ─── Tag → Rule mapping ───────────────────────────────────────────────────────

interface TagRule {
  keyword: string
  menu: string | null
  caution: string | null
}

const TAG_RULES: Record<string, TagRule> = {
  dry_skin:     { keyword: '保湿',    menu: 'モイスチャーフェイシャル',     caution: null },
  uv_sensitive: { keyword: 'UVケア', menu: 'UVプロテクションコース',       caution: null },
  sales_hate:   { keyword: '信頼',    menu: null,                           caution: '提案は1回のみ、押しつけ厳禁' },
  vip:          { keyword: '特別感',  menu: 'プレミアムエイジングケア',     caution: null },
  repeat_high:  { keyword: '継続ケア', menu: '定期コース',                  caution: null },
}

// Priority order for selecting the top tag
const TAG_PRIORITY: (keyof typeof TAG_RULES)[] = [
  'vip',
  'repeat_high',
  'dry_skin',
  'uv_sensitive',
  'sales_hate',
]

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SuggestionResult {
  empathy: string            // ① 共感
  personal: string           // ② 個別感
  proposal: string           // ③ 提案
  closing: string            // ④ 圧を消す
  caution: string | null
  menuRecommendation: string | null
}

interface CustomerInput {
  name: string
  visit_count: number
  last_visit_date: string | null
  churn_risk_score: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function daysSince(dateStr: string | null): number {
  if (!dateStr) return 90
  const diff = Date.now() - new Date(dateStr).getTime()
  return Math.floor(diff / 86400000)
}

function getTopTag(tags: Partial<AiTagRow>): { key: string; rule: TagRule } | null {
  for (const key of TAG_PRIORITY) {
    if (tags[key as keyof AiTagRow] === true) {
      return { key, rule: TAG_RULES[key] }
    }
  }
  return null
}

function buildEmpathy(days: number, churnRisk: number): string {
  if (days <= 7) {
    return 'いつもご来店いただき、ありがとうございます。'
  } else if (days <= 30) {
    return `前回のご来店から${days}日が経ちました。お肌の調子はいかがでしょうか？`
  } else if (days <= 60) {
    return `${days}日ぶりのご連絡です。お元気にお過ごしでしょうか？`
  } else if (churnRisk >= 60) {
    return `しばらくご来店がなく、お顔が見られず少し寂しかったです。お変わりありませんか？`
  } else {
    return `${days}日ぶりです。季節の変わり目、お肌の状態は落ち着いていますか？`
  }
}

function buildPersonal(name: string, visitCount: number, topRule: TagRule | null): string {
  const firstName = name.split(/\s+/)[0] ?? name
  const keyword = topRule?.keyword ?? 'お肌のケア'

  if (visitCount >= 10) {
    return `${firstName}さまにはいつも${keyword}を意識したご提案ができればと思っております。長くご愛顧いただき、本当にありがとうございます。`
  } else if (visitCount >= 3) {
    return `${firstName}さまのお肌に合った${keyword}を引き続きご提案できればと思っています。`
  } else {
    return `${firstName}さまのことを覚えていますよ。${keyword}を大切に、一緒にケアしていきましょう。`
  }
}

function buildProposal(topRule: TagRule | null): string {
  if (!topRule || !topRule.menu) {
    return '次回のご来店では、今のお肌の状態に合わせた最適なメニューをご提案いたします。'
  }
  return `次回は「${topRule.menu}」をご用意してお待ちしております。ぜひご検討ください。`
}

// ─── Core builder ─────────────────────────────────────────────────────────────

/**
 * Build a suggestion from tags and customer info using rule-based template logic.
 * Does NOT call any AI API.
 */
export function buildSuggestion(
  tags: Partial<AiTagRow>,
  customer: CustomerInput
): SuggestionResult {
  const days = daysSince(customer.last_visit_date)
  const topTag = getTopTag(tags)
  const topRule = topTag?.rule ?? null

  const empathy = buildEmpathy(days, customer.churn_risk_score)
  const personal = buildPersonal(customer.name, customer.visit_count, topRule)
  const proposal = buildProposal(topRule)
  const closing = 'ご不明な点やご要望がございましたら、お気軽にご相談ください。'

  return {
    empathy,
    personal,
    proposal,
    closing,
    caution: topRule?.caution ?? null,
    menuRecommendation: topRule?.menu ?? null,
  }
}

// ─── Optional AI naturalization (last line only) ──────────────────────────────

/**
 * Calls Claude Haiku to naturalize the last line only.
 * Intended for polishing the closing line into more natural Japanese.
 * Falls back to the original string on any error.
 */
export async function naturalizeLastLine(line: string): Promise<string> {
  try {
    // Dynamic import to avoid breaking in environments without the SDK
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic()

    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 100,
      messages: [
        {
          role: 'user',
          content: `以下の文章を、美容サロンのスタッフらしい自然で温かい日本語に短く言い換えてください。意味を変えずに1文で返してください。\n\n元の文: ${line}`,
        },
      ],
    })

    const content = response.content[0]
    if (content.type === 'text') {
      return content.text.trim()
    }
    return line
  } catch {
    // Fallback to original line on any error
    return line
  }
}
