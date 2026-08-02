/**
 * POST /api/customers/[id]/homecare-message — ホームケアAIフォローメッセージ生成 (PHASE HC-6)
 *
 * 認証: extractStaffFromRequest + canAccessCustomer (AUTH-2 準拠)
 *
 * 入力（クライアントから渡す。DBへの新規クエリ・保存は行わない）:
 *   productName, lastPurchasedAt, daysSincePurchase, customerName,
 *   menuId(PHASE MENU-AI-3・任意・省略時は既存挙動と同じ)
 *
 * LLM: Claude Haiku（timeline-summary route と同一モデル・同一呼び出し方式）。
 * キャッシュ・DB保存は行わない（毎回生成。DB変更・migration禁止のため）。
 *
 * 制約: 使用方法・効果・注意事項など辞書側にしかない事実は生成させない。
 * 顧客名・商品名・前回購入日・経過日数のみを使った温かい確認メッセージに限定する
 * （架空の使い方情報を作らせないため）。
 *
 * 失敗時（APIキー未設定・LLMエラー・不正レスポンス等）は success:false を返し、
 * クライアント側で既存辞書メッセージにフォールバックする。
 *
 * PHASE MENU-AI-3(2026-08-01): menuId指定時のみ、menuRepo.findById()でbrain_menusを
 * 1件取得しMenu AI Context(ai_tags/カテゴリ/価格帯/施術時間/禁忌/おすすめ頻度の
 * 許可リストのみ・buildMenuAIContext参照)をプロンプト末尾に追記する。既存プロンプトの
 * 文章(SYSTEM_PROMPT・callClaude内のprompt組み立て)は書き換えない。現状
 * CustomerBottomSheetはmenuIdを送っていない(UI変更禁止のため今回は未接続)ため、
 * 実際に付与されるのはmenuIdを渡す呼び出し元が現れてから。取得できない/失敗時は
 * エラーにせず、Menu AI Contextなしで従来どおり生成する。
 */
import { NextRequest, NextResponse } from 'next/server'
import { idSchema, toValidationErrorResponse } from '../../../_schemas/common'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'
import { getRepos } from '../../../../lib/repos'
import { buildMenuAIContext, formatMenuAIContextBlock } from '@/lib/menu/buildMenuAIContext'

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY

const SYSTEM_PROMPT = `あなたは高級美容サロンのスタッフが顧客に送るフォローメッセージ作成アシスタントです。
以下の情報のみを使って、温かく短いフォローメッセージを1つ日本語で作成してください。

厳守事項:
- 商品の使い方・使用頻度・効果・注意事項には一切言及しないこと（それらの事実は与えられていないため）
- 「お元気ですか」「使い心地はいかがですか」のような、体調や商品との相性を気遣う短い声かけに徹すること
- 押し売り感を出さないこと
- 出力はメッセージ本文のみ（前置き・説明・記号装飾・見出しは一切不要）
- 150文字以内`

interface RequestBody {
  productName:        string
  lastPurchasedAt:    string
  daysSincePurchase:  number
  customerName:       string
  menuId?:             string
}

async function resolveMenuAIContextBlock(menuId: string | undefined): Promise<string | null> {
  if (!menuId) return null
  try {
    const menu = await getRepos().menuRepo.findById(menuId)
    return menu ? formatMenuAIContextBlock(buildMenuAIContext(menu)) : null
  } catch {
    return null
  }
}

async function callClaude(body: RequestBody): Promise<string | null> {
  if (!ANTHROPIC_KEY) return null
  try {
    const basePrompt = `顧客名: ${body.customerName}\n商品名: ${body.productName}\n前回購入日: ${body.lastPurchasedAt}\n前回購入からの経過日数: ${body.daysSincePurchase}日`
    const menuAIContextBlock = await resolveMenuAIContextBlock(body.menuId)
    const prompt = menuAIContextBlock ? `${basePrompt}\n\n${menuAIContextBlock}` : basePrompt

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'content-type':      'application/json',
        'x-api-key':         ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system:     SYSTEM_PROMPT,
        messages:   [{ role: 'user', content: prompt }],
      }),
    })
    if (!res.ok) return null

    const j   = await res.json() as { content: Array<{ type: string; text: string }> }
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

  if (
    typeof body.productName !== 'string' || !body.productName ||
    typeof body.lastPurchasedAt !== 'string' || !body.lastPurchasedAt ||
    typeof body.daysSincePurchase !== 'number' ||
    typeof body.customerName !== 'string' || !body.customerName
  ) {
    return NextResponse.json({ success: false, error: 'invalid_body' }, { status: 400 })
  }

  const normalized: RequestBody = {
    productName: body.productName,
    lastPurchasedAt: body.lastPurchasedAt,
    daysSincePurchase: body.daysSincePurchase,
    customerName: body.customerName,
    menuId: typeof body.menuId === 'string' && body.menuId.length > 0 ? body.menuId : undefined,
  }

  const message = await callClaude(normalized)
  if (!message) {
    return NextResponse.json({ success: false, error: 'generation_failed' }, { status: 503 })
  }

  return NextResponse.json({ success: true, message })
}
