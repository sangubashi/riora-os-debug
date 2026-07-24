/**
 * POST /api/customers/[id]/line-message — LINE文面生成 (PHASE2-C-4)
 *
 * 【重要】本APIはLINE Messaging API・Webhookを一切呼ばない。生成した文面を
 * JSONで返すだけで、送信は行わない。送信はスタッフ本人がLINEアプリから手動で行う
 * (Phase2-B/Cで確定した正式仕様)。
 *
 * 認証: extractStaffFromRequest + canAccessCustomer (AUTH-2 準拠、homecare-messageと同型)
 *
 * 入力（クライアントから渡す。既にCustomerBottomSheetがロード済みのデータを使い、
 * このAPI内で顧客の新規クエリは行わない。関連記事の一致検索のみ、承認済み記事の
 * keywordsに対してこのAPI内でDBクエリする）:
 *   customerName, skinTags(肌タグの日本語ラベル), recentVisits, homecareProducts,
 *   recentNoteSummaries(接客メモ)
 *
 * LLM: Claude Haiku（homecare-message routeと同一モデル・同一呼び出し方式）。
 * キャッシュ・DB保存は行わない（毎回生成）。
 *
 * 制約: 効果保証・残量推定・買い替え促進の文言は生成させない。関連記事は
 * source_url・title・summaryを一切プロンプトに含めない（KNOWLEDGE_AI_INTEGRATION_AUDIT_1
 * 6章の「summaryを画面表示経路に直接乗せない」防御方針を踏襲し、LLM入力にも適用する。
 * 使うのは承認済み記事とのkeywords/category一致有無のみ）。
 *
 * 生成理由（PHASE2-C追加確認）: レスポンスにreasons(タグ名・カテゴリ名のみの配列)を含める。
 * AI提案(generateNextActions.ts)・接客ヒント(CustomerBottomSheet.tsx)と共通の
 * buildMatchReasons()（src/lib/nextAction/knowledgeMatch.ts）を使い、記事タイトル・
 * 本文・summary・URLはreasonsにも一切含めない。
 *
 * 失敗時（APIキー未設定・LLMエラー等）はsuccess:falseを返す。クライアント側で
 * フォールバック文言は持たない(この機能は「生成→編集→コピー」のみのため、
 * 生成失敗時は再試行を促すのみでよい)。
 */
import { NextRequest, NextResponse } from 'next/server'
import { idSchema, toValidationErrorResponse } from '../../../_schemas/common'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'
import { getRepos } from '../../../../lib/repos'
import { buildProductCategoryVocabulary, buildMatchReasons } from '@/lib/nextAction/knowledgeMatch'

const SYSTEM_PROMPT = `あなたは高級美容サロンのスタッフが顧客へLINEで送るメッセージの下書きを作成するアシスタントです。
渡された情報のみを使って、温かく自然な日本語のLINEメッセージを1つ作成してください。
このメッセージはスタッフが内容を確認・編集した上で、スタッフ自身の手でLINEアプリから手動送信します。
あなた自身がメッセージを送信することはありません。

厳守事項:
- 効果を保証する表現（「必ず改善します」等）は使わないこと
- 残量を推定する表現（「そろそろ無くなる頃」等）は使わないこと
- 買い替え・購入を促す表現（「そろそろお買い替えを」等）は使わないこと
- 診断や断定を避け、体調や肌の様子を気遣う質問・確認の形にすること
- 渡されていない事実（使い方・効果・在庫状況など）を作り出さないこと
- 「〜という記事によると」のような情報源への言及は一切しないこと
- 押し売り感を出さないこと
- 出力はメッセージ本文のみ（前置き・説明・記号装飾・見出しは一切不要）
- 200文字以内`

interface RecentVisit {
  menuName: string | null
  visitDate: string
}
interface HomecareProduct {
  productName: string
  lastPurchasedAt: string
}
interface RequestBody {
  customerName:        string
  skinTags:             string[]
  recentVisits:         RecentVisit[]
  homecareProducts:     HomecareProduct[]
  recentNoteSummaries:  string[]
}

function buildPrompt(body: RequestBody, matchedTopics: string[]): string {
  const lines: string[] = [`顧客名: ${body.customerName}`]

  if (body.skinTags.length > 0) {
    lines.push(`肌の悩み: ${body.skinTags.join('・')}`)
  }
  if (body.recentVisits.length > 0) {
    const visits = body.recentVisits
      .slice(0, 3)
      .map(v => `${v.visitDate}(${v.menuName ?? '施術内容不明'})`)
      .join('、')
    lines.push(`直近の来店・施術履歴: ${visits}`)
  }
  if (body.homecareProducts.length > 0) {
    const products = body.homecareProducts
      .slice(0, 3)
      .map(p => `${p.productName}(最終購入${p.lastPurchasedAt})`)
      .join('、')
    lines.push(`購入・使用中のホームケア商品: ${products}`)
  }
  if (body.recentNoteSummaries.length > 0) {
    lines.push(`接客メモ: ${body.recentNoteSummaries.slice(0, 3).join(' / ')}`)
  }
  if (matchedTopics.length > 0) {
    // 関連記事の存在・タイトル・summaryは一切渡さない。一致した肌悩みキーワードのみを
    // 「話題の切り口」として渡す(KNOWLEDGE_AI_INTEGRATION_AUDIT_1 6章の防御方針)。
    lines.push(`会話の切り口として使える話題: ${matchedTopics.join('・')}`)
  }
  return lines.join('\n')
}

async function callClaude(prompt: string): Promise<string | null> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) return null
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'content-type':      'application/json',
        'x-api-key':         anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system:     SYSTEM_PROMPT,
        messages:   [{ role: 'user', content: prompt }],
      }),
    })
    if (!res.ok) return null

    const j    = await res.json() as { content: Array<{ type: string; text: string }> }
    const text = j.content?.[0]?.text?.trim() ?? ''
    return text.length > 0 ? text : null
  } catch {
    return null
  }
}

export async function POST(
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

  let body: Partial<RequestBody>
  try {
    body = await req.json() as Partial<RequestBody>
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_body' }, { status: 400 })
  }

  if (typeof body.customerName !== 'string' || !body.customerName) {
    return NextResponse.json({ success: false, error: 'invalid_body' }, { status: 400 })
  }

  const normalized: RequestBody = {
    customerName:       body.customerName,
    skinTags:            Array.isArray(body.skinTags) ? body.skinTags.filter((t): t is string => typeof t === 'string') : [],
    recentVisits:        Array.isArray(body.recentVisits) ? body.recentVisits : [],
    homecareProducts:    Array.isArray(body.homecareProducts) ? body.homecareProducts : [],
    recentNoteSummaries: Array.isArray(body.recentNoteSummaries) ? body.recentNoteSummaries.filter((t): t is string => typeof t === 'string') : [],
  }

  // 関連記事(ブログ)との一致確認: keywords/category/productsの一致有無のみを使う。
  // 記事本文・タイトル・summary・source_urlはここでも一切扱わない
  // (KNOWLEDGE_AI_INTEGRATION_AUDIT_1 6章準拠)。
  const tagVocabulary      = Array.from(new Set(normalized.skinTags))
  const categoryVocabulary = buildProductCategoryVocabulary(normalized.homecareProducts.map(p => p.productName))
  const productNames       = normalized.homecareProducts.map(p => p.productName)

  let matchedTagKeywords: string[] = []
  let matchedCategories:  string[] = []
  let hasRelatedArticleByProduct = false
  try {
    const repos = getRepos()
    const [keywordArticles, categoryArticles, productArticles] = await Promise.all([
      repos.blogArticleRepo.listApprovedByKeywords(tagVocabulary, 5),
      repos.blogArticleRepo.listApprovedByCategories(categoryVocabulary, 5),
      repos.blogArticleRepo.listApprovedByProducts(productNames, 5),
    ])
    const keywordSet  = new Set(keywordArticles.flatMap(a => a.keywords))
    const categorySet = new Set(categoryArticles.map(a => a.category).filter((c): c is string => Boolean(c)))
    matchedTagKeywords = tagVocabulary.filter(k => keywordSet.has(k))
    matchedCategories  = categoryVocabulary.filter(c => categorySet.has(c))
    hasRelatedArticleByProduct = productArticles.length > 0
  } catch {
    matchedTagKeywords = []
    matchedCategories  = []
    hasRelatedArticleByProduct = false
  }

  const reasons = buildMatchReasons({
    matchedTagKeywords,
    matchedCategories,
    hasRelatedArticleByProduct,
    hasHomecareProduct: normalized.homecareProducts.length > 0,
    hasRecentVisit:      normalized.recentVisits.length > 0,
    hasRecentPurchase:   normalized.homecareProducts.length > 0,
  })

  const prompt  = buildPrompt(normalized, matchedTagKeywords)
  const message = await callClaude(prompt)
  if (!message) {
    return NextResponse.json({ success: false, error: 'generation_failed' }, { status: 503 })
  }

  return NextResponse.json({ success: true, message, reasons })
}
