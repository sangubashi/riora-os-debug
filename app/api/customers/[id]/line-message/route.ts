/**
 * POST /api/customers/[id]/line-message — LINE文面生成 (PHASE2-C-4, PHASE LINE-AI-1でtype対応拡張)
 *
 * 【重要】本APIはLINE Messaging API・Webhookを一切呼ばない。生成した文面を
 * JSONで返すだけで、送信は行わない。送信はスタッフ本人がLINEアプリから手動で行う
 * (Phase2-B/Cで確定した正式仕様)。
 *
 * 認証: extractStaffFromRequest + canAccessCustomer (AUTH-2 準拠、homecare-messageと同型)
 *
 * type（PHASE LINE-AI-1・任意。省略時は既存の汎用生成のまま・後方互換）:
 *   'thanks'   来店お礼AI    — 施術内容・音声メモ(insight_tags)・肌タグ・ホームケア・来店回数・会話内容
 *   'homecare' ホームケア提案AI — 購入商品・施術内容・肌状態・音声メモ(insight_tags)・AIインサイト(insight_tags)
 *   'reminder' 来店リマインドAI — 推奨来店サイクル・前回来店日・来店回数・顧客状態(churnRisk)
 *   未指定     既存の汎用1種メッセージ（PHASE2-C-4のまま・変更なし）
 *
 * 入力（クライアントから渡す。既にCustomerBottomSheetがロード済みのデータを使い、
 * このAPI内で顧客の新規クエリは行わない。関連記事の一致検索のみ、承認済み記事の
 * keywordsに対してこのAPI内でDBクエリする）:
 *   customerName, skinTags(肌タグの日本語ラベル), recentVisits, homecareProducts,
 *   recentNoteSummaries(接客メモ), insightTags(voice_notes.insight_tags集約・PHASE LINE-AI-1),
 *   visitCount, lastVisitDate, recommendedCycleDays, churnRisk, contraindicationTitles,
 *   menuId(PHASE MENU-AI-3・任意・省略時は既存挙動と同じ)
 *
 * PHASE MENU-AI-3(2026-08-01): menuId指定時のみ、menuRepo.findById()で
 * brain_menusを1件取得しMenu AI Context(ai_tags/カテゴリ/価格帯/施術時間/禁忌/
 * おすすめ頻度の許可リストのみ・buildMenuAIContext参照)をプロンプト末尾に追記する。
 * 既存プロンプトの文章(SYSTEM_PROMPT*・buildXxxPrompt)は書き換えない。現状
 * CustomerBottomSheetはmenuIdを送っていない(UI変更禁止のため今回は未接続)ため、
 * 実際に付与されるのはmenuIdを渡す呼び出し元が現れてから。
 *
 * 【重要・利用禁止情報（ユーザー指示・2026-07-31確定）】
 *   customer_memories本文・AI Timelineのsummary/recentChange/nextFocusは、
 *   本APIに一切渡さない・使わない。src/types/customerMemory.tsの絶対ルール
 *   （「LINE提案のいずれにもimportしないこと」）およびtimeline-summary routeの
 *   「Customer Memory本文はAI Timeline専用」を遵守する。音声メモ由来の文脈は
 *   voice_notes.insight_tags（ルールベースで抽出済みのタグ、生の発言内容ではない）
 *   のみを使う。
 *
 * LLM: Claude Haiku（homecare-message routeと同一モデル・同一呼び出し方式）。
 * キャッシュ・DB保存は行わない（毎回生成）。
 *
 * 制約: 効果保証・残量推定・買い替え促進の文言は生成させない。関連記事は
 * source_url・title・summaryを一切プロンプトに含めない（KNOWLEDGE_AI_INTEGRATION_AUDIT_1
 * 6章の「summaryを画面表示経路に直接乗せない」防御方針を踏襲し、LLM入力にも適用する。
 * 使うのは承認済み記事とのkeywords/category一致有無のみ）。禁忌事項(contraindicationTitles)
 * はタイトルのみを「これに抵触する提案を避ける」制約として渡し、メッセージ本文で
 * 禁忌の内容そのものに言及させない。
 *
 * 生成理由（PHASE2-C追加確認）: レスポンスにreasons(タグ名・カテゴリ名のみの配列)を含める。
 * AI提案(generateNextActions.ts)・接客ヒント(CustomerBottomSheet.tsx)と共通の
 * buildMatchReasons()（src/lib/nextAction/knowledgeMatch.ts）を使い、記事タイトル・
 * 本文・summary・URLはreasonsにも一切含めない。
 *
 * 失敗時（APIキー未設定・LLMエラー等）はsuccess:falseを返す。クライアント側で
 * フォールバック文言は持たない(この機能は「生成→編集→コピー」のみのため、
 * 生成失敗時は再試行を促すのみでよい)。
 *
 * variant（LINE UX改善・任意。省略時は既存の'normal'のまま・後方互換）:
 *   'normal' 通常版（既存の文字数制限のまま） / 'short' 簡易版（60文字程度・要点のみ）。
 *   永続化はしない（Tier1・CustomerBottomSheet側のローカルstateのみで管理）。
 *
 * previousDraft（LINE UX改善・任意）: 直前にこの画面で表示していた下書き文面を渡すと、
 * 「別案を生成」として同じ入力から表現を変えた文面を作る。DBには保存せず、この
 * リクエスト内でプロンプトに含めるだけ。
 */
import { NextRequest, NextResponse } from 'next/server'
import { idSchema, toValidationErrorResponse } from '../../../_schemas/common'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'
import { claudeLimiter } from '@/lib/rateLimit'
import { getRepos } from '../../../../lib/repos'
import { buildProductCategoryVocabulary, buildMatchReasons } from '@/lib/nextAction/knowledgeMatch'
import { buildMenuAIContext, formatMenuAIContextBlock } from '@/lib/menu/buildMenuAIContext'

type LineMessageType = 'thanks' | 'homecare' | 'reminder'

const COMMON_CONSTRAINTS = `
厳守事項:
- 効果を保証する表現（「必ず改善します」等）は使わないこと
- 残量を推定する表現（「そろそろ無くなる頃」等）は使わないこと
- 買い替え・購入を強く促す表現（「今すぐお買い替えを」等）は使わないこと
- 診断や断定を避け、体調や肌の様子を気遣う質問・確認の形にすること
- 渡されていない事実（使い方・効果・在庫状況・医療情報など）を作り出さないこと
- 禁忌情報が渡されている場合、その内容自体には一切言及せず、抵触する提案もしないこと
- 「〜という記事によると」のような情報源への言及は一切しないこと
- 押し売り感を出さないこと
- 出力はメッセージ本文のみ（前置き・説明・記号装飾・見出しは一切不要）`

const SYSTEM_PROMPT_BASE = `あなたは高級美容サロンのスタッフが顧客へLINEで送るメッセージの下書きを作成するアシスタントです。
渡された情報のみを使って、温かく自然な日本語のLINEメッセージを1つ作成してください。
このメッセージはスタッフが内容を確認・編集した上で、スタッフ自身の手でLINEアプリから手動送信します。
あなた自身がメッセージを送信することはありません。
${COMMON_CONSTRAINTS}`

const SYSTEM_PROMPT_THANKS_BASE = `あなたは高級美容サロンのスタッフが、来店直後の顧客へLINEで送る「来店お礼」メッセージの下書きを作成するアシスタントです。
渡された情報（本日の施術内容・肌の悩み・ホームケア状況・来店回数・接客メモ・音声メモから抽出されたタグ）のみを使って、
本日のご来店に対する温かく自然な感謝のメッセージを1つ作成してください。
このメッセージはスタッフが内容を確認・編集した上で、スタッフ自身の手でLINEアプリから手動送信します。
あなた自身がメッセージを送信することはありません。
${COMMON_CONSTRAINTS}
- 次回の売り込みや提案は含めず、あくまで「今日来てくれたことへの感謝」に徹すること`

const SYSTEM_PROMPT_HOMECARE_BASE = `あなたは高級美容サロンのスタッフが顧客へLINEで送る「ホームケアフォロー」メッセージの下書きを作成するアシスタントです。
渡された情報（購入・使用中のホームケア商品・直近の施術内容・肌の状態・音声メモから抽出されたタグ）のみを使って、
押し売りではない、自然な気遣いのフォローメッセージを1つ作成してください。
このメッセージはスタッフが内容を確認・編集した上で、スタッフ自身の手でLINEアプリから手動送信します。
あなた自身がメッセージを送信することはありません。
${COMMON_CONSTRAINTS}
- 「購入してください」「補充してください」のような直接的な購入依頼は避け、使い心地や調子を尋ねる形にすること`

const SYSTEM_PROMPT_REMINDER_BASE = `あなたは高級美容サロンのスタッフが顧客へLINEで送る「来店リマインド」メッセージの下書きを作成するアシスタントです。
渡された情報（推奨来店サイクル・前回来店日からの経過日数・来店回数・離脱リスクの傾向）のみを使って、
自然で押し付けがましくない次回来店促進のメッセージを1つ作成してください。
このメッセージはスタッフが内容を確認・編集した上で、スタッフ自身の手でLINEアプリから手動送信します。
あなた自身がメッセージを送信することはありません。
${COMMON_CONSTRAINTS}
- 「そろそろ来てください」といった催促口調は避け、体調や肌の様子を気遣いつつ次回の来店を軽く案内する形にすること`

type LineMessageVariant = 'normal' | 'short'

/** variant別の文字数指示。'normal'は既存の各typeの制限文をそのまま維持(後方互換)。 */
const LENGTH_INSTRUCTION: Record<'generic' | LineMessageType, Record<LineMessageVariant, string>> = {
  generic:  { normal: '- 200文字以内', short: '- 60文字以内・要点のみを一言で' },
  thanks:   { normal: '- 180文字以内', short: '- 60文字以内・要点のみを一言で' },
  homecare: { normal: '- 200文字以内', short: '- 60文字以内・要点のみを一言で' },
  reminder: { normal: '- 180文字以内', short: '- 60文字以内・要点のみを一言で' },
}

function systemPromptFor(type: LineMessageType | undefined, variant: LineMessageVariant): string {
  const base = type === 'thanks'   ? SYSTEM_PROMPT_THANKS_BASE
             : type === 'homecare' ? SYSTEM_PROMPT_HOMECARE_BASE
             : type === 'reminder' ? SYSTEM_PROMPT_REMINDER_BASE
             : SYSTEM_PROMPT_BASE
  return `${base}\n${LENGTH_INSTRUCTION[type ?? 'generic'][variant]}`
}

interface RecentVisit {
  menuName: string | null
  visitDate: string
}
interface HomecareProduct {
  productName: string
  lastPurchasedAt: string
}
interface RequestBody {
  type?:                 LineMessageType
  /** 通常版/簡易版の切り替え(任意・省略時は'normal'・後方互換)。永続化はしない。 */
  variant?:               LineMessageVariant
  /** 「別案を生成」用。直前の下書き文面を渡すと、表現を変えた別パターンを作る。DB保存はしない。 */
  previousDraft?:         string
  customerName:        string
  skinTags:             string[]
  recentVisits:         RecentVisit[]
  homecareProducts:     HomecareProduct[]
  recentNoteSummaries:  string[]
  // PHASE LINE-AI-1: 追加入力（すべて任意・省略時は既存の汎用生成と同じ挙動）
  insightTags?:            string[]
  visitCount?:             number
  lastVisitDate?:          string | null
  recommendedCycleDays?:   number | null
  churnRisk?:              number | null
  contraindicationTitles?: string[]
  /**
   * PHASE MENU-AI-3: 施術メニューのbrain_menus.id（任意・省略時は既存挙動と同じ）。
   * 現状クライアント(CustomerBottomSheet)は本フィールドを渡していない
   * （Customer Bottom SheetのUI変更禁止のため今回は未接続）。指定された場合のみ
   * Menu AI Contextをプロンプト末尾に追記する。
   */
  menuId?: string
}

/** daysSince: 前回来店からの経過日数（lastVisitDateがなければnull）。 */
function daysSince(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return null
  return Math.max(0, Math.round((Date.now() - d.getTime()) / 86_400_000))
}

function buildCommonLines(body: RequestBody): string[] {
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
  if (body.insightTags && body.insightTags.length > 0) {
    lines.push(`音声メモから抽出された傾向タグ: ${body.insightTags.slice(0, 8).join('・')}`)
  }
  if (body.contraindicationTitles && body.contraindicationTitles.length > 0) {
    lines.push(`禁忌情報(内容には言及せず、抵触する提案を避けるためだけに使う): ${body.contraindicationTitles.join('・')}`)
  }
  return lines
}

function buildPrompt(body: RequestBody, matchedTopics: string[]): string {
  const lines = buildCommonLines(body)

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

/** ① 来店お礼AI: 施術内容・音声メモ・肌悩み・ホームケア・来店回数・会話内容 */
function buildThanksPrompt(body: RequestBody, matchedTopics: string[]): string {
  const lines = buildCommonLines(body)
  if (typeof body.visitCount === 'number') {
    lines.push(`来店回数: ${body.visitCount}回目`)
  }
  if (body.recentNoteSummaries.length > 0) {
    lines.push(`会話内容(接客メモ): ${body.recentNoteSummaries.slice(0, 3).join(' / ')}`)
  }
  if (matchedTopics.length > 0) {
    lines.push(`会話の切り口として使える話題: ${matchedTopics.join('・')}`)
  }
  return lines.join('\n')
}

/** ② ホームケア提案AI: 購入商品・施術内容・肌状態・音声メモ・AIインサイト */
function buildHomecarePrompt(body: RequestBody, matchedTopics: string[]): string {
  const lines = buildCommonLines(body)
  if (matchedTopics.length > 0) {
    lines.push(`会話の切り口として使える話題: ${matchedTopics.join('・')}`)
  }
  return lines.join('\n')
}

/** ③ 来店リマインドAI: 推奨サイクル・前回来店・来店頻度・顧客状態 */
function buildReminderPrompt(body: RequestBody): string {
  const lines: string[] = [`顧客名: ${body.customerName}`]
  if (typeof body.visitCount === 'number') {
    lines.push(`来店回数: ${body.visitCount}回目`)
  }
  const days = daysSince(body.lastVisitDate)
  if (days !== null) {
    lines.push(`前回来店からの経過日数: ${days}日`)
  }
  if (typeof body.recommendedCycleDays === 'number') {
    lines.push(`推奨来店サイクル: 約${body.recommendedCycleDays}日ごと`)
  }
  if (typeof body.churnRisk === 'number') {
    const level = body.churnRisk >= 60 ? '来店間隔が空きがち' : body.churnRisk >= 30 ? 'やや間隔が空き気味' : '安定して来店中'
    lines.push(`顧客状態: ${level}`)
  }
  if (body.skinTags.length > 0) {
    lines.push(`肌の悩み: ${body.skinTags.join('・')}`)
  }
  return lines.join('\n')
}

/**
 * PHASE LINE-AI-2: LLMが「プレフィックス禁止」の指示に従わず、
 * 「○○へのリマインドメッセージ：」「来店お礼メッセージ：」のような見出し行を
 * 本文の前に付けることがあるため、サーバー側でも軽く除去する（プロンプトのみに
 * 依存しない）。1行目が「短い・コロンで終わる・句読点(。！？)を含まない」場合のみ
 * ラベル行とみなして除去する保守的な判定（本文の一部を誤って消さないため）。
 */
function stripPreamble(text: string): string {
  const newlineIdx = text.indexOf('\n')
  const firstLine  = (newlineIdx === -1 ? text : text.slice(0, newlineIdx)).trim()

  const looksLikeLabel =
    firstLine.length > 0 &&
    firstLine.length <= 40 &&
    /[：:]$/.test(firstLine) &&
    !/[。！？.!?]/.test(firstLine)

  if (!looksLikeLabel) return text.trim()
  if (newlineIdx === -1) return '' // 全文がラベルだけだった場合(想定外・安全側に倒す)

  return text.slice(newlineIdx + 1).replace(/^\n+/, '').trim()
}

async function callClaude(prompt: string, systemPrompt: string, variant: LineMessageVariant): Promise<string | null> {
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
        max_tokens: variant === 'short' ? 120 : 400,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: prompt }],
      }),
    })
    if (!res.ok) return null

    const j    = await res.json() as { content: Array<{ type: string; text: string }> }
    const raw  = j.content?.[0]?.text?.trim() ?? ''
    const text = stripPreamble(raw)
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

  const rl = await claudeLimiter.limit(staff.authUserId)
  if (!rl.success) {
    return NextResponse.json(
      { success: false, error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.reset - Date.now()) / 1000)) } },
    )
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

  const VALID_TYPES = new Set<LineMessageType>(['thanks', 'homecare', 'reminder'])
  const type: LineMessageType | undefined =
    typeof body.type === 'string' && VALID_TYPES.has(body.type as LineMessageType)
      ? (body.type as LineMessageType)
      : undefined

  const variant: LineMessageVariant = body.variant === 'short' ? 'short' : 'normal'
  const previousDraft: string | undefined =
    typeof body.previousDraft === 'string' && body.previousDraft.trim().length > 0
      ? body.previousDraft.trim().slice(0, 500)
      : undefined

  const normalized: RequestBody = {
    type,
    variant,
    previousDraft,
    customerName:       body.customerName,
    skinTags:            Array.isArray(body.skinTags) ? body.skinTags.filter((t): t is string => typeof t === 'string') : [],
    recentVisits:        Array.isArray(body.recentVisits) ? body.recentVisits : [],
    homecareProducts:    Array.isArray(body.homecareProducts) ? body.homecareProducts : [],
    recentNoteSummaries: Array.isArray(body.recentNoteSummaries) ? body.recentNoteSummaries.filter((t): t is string => typeof t === 'string') : [],
    insightTags:            Array.isArray(body.insightTags) ? body.insightTags.filter((t): t is string => typeof t === 'string') : [],
    visitCount:             typeof body.visitCount === 'number' ? body.visitCount : undefined,
    lastVisitDate:          typeof body.lastVisitDate === 'string' ? body.lastVisitDate : null,
    recommendedCycleDays:   typeof body.recommendedCycleDays === 'number' ? body.recommendedCycleDays : null,
    churnRisk:              typeof body.churnRisk === 'number' ? body.churnRisk : null,
    contraindicationTitles: Array.isArray(body.contraindicationTitles) ? body.contraindicationTitles.filter((t): t is string => typeof t === 'string') : [],
    menuId:                 typeof body.menuId === 'string' && body.menuId.length > 0 ? body.menuId : undefined,
  }

  // PHASE MENU-AI-3: menuIdが渡された場合のみMenu AI Contextを組み立てる。
  // 未指定・取得失敗・該当なしはすべてnullのまま(④: エラーにしない・従来どおり生成)。
  let menuAIContextBlock: string | null = null
  if (normalized.menuId) {
    try {
      const menu = await getRepos().menuRepo.findById(normalized.menuId)
      menuAIContextBlock = menu ? formatMenuAIContextBlock(buildMenuAIContext(menu)) : null
    } catch {
      menuAIContextBlock = null
    }
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

  const basePrompt = (() => {
    switch (type) {
      case 'thanks':   return buildThanksPrompt(normalized, matchedTagKeywords)
      case 'homecare': return buildHomecarePrompt(normalized, matchedTagKeywords)
      case 'reminder': return buildReminderPrompt(normalized)
      default:         return buildPrompt(normalized, matchedTagKeywords)
    }
  })()
  const systemPrompt = systemPromptFor(type, variant)

  // PHASE MENU-AI-3: 既存プロンプトの文章は書き換えず、末尾にMenu AI Contextブロックを
  // 追記するだけ(⑤: 新しい指示文はAIへ渡さない)。3種類(thanks/homecare/reminder)+
  // 汎用生成のいずれも対象。
  const withMenuContext = menuAIContextBlock ? `${basePrompt}\n\n${menuAIContextBlock}` : basePrompt

  // 「別案を生成」: 直前の下書きを渡し、同じ入力から表現を変えた別パターンを作らせる。
  const prompt = previousDraft
    ? `${withMenuContext}\n\n直前に生成した文章（この文面とは言葉選び・文の構成を変えて、別パターンを1つ作成すること）:\n${previousDraft}`
    : withMenuContext

  const message = await callClaude(prompt, systemPrompt, variant)
  if (!message) {
    return NextResponse.json({ success: false, error: 'generation_failed' }, { status: 503 })
  }

  return NextResponse.json({ success: true, message, reasons })
}
