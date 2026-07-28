/**
 * /api/customers/[id]/line-send-log — LINE送信履歴 (PHASE LINE-LOG-1)
 *
 * 【重要】本アプリはLINE Messaging API・Webhookを呼ばない設計(line-message route等と同じ)。
 * 「送信」はスタッフがLINEアプリから手動で行うため、このAPIが記録するのは実際の送信
 * イベントではなく、CustomerBottomSheet側の「コピー」操作(=送信直前の最終アクション)を
 * 送信とみなした近似ログである。
 *
 * 新規テーブル・migrationは作らない。既存の汎用運用ログテーブル brain_ops_logs
 * (kind列で種別を区別する設計・20260621_csv_import_security_diff.sql参照)を
 * kind='line_send:<種別>' として再利用する。
 *
 * PIIゼロ契約(brain_ops_logs.detail): 氏名・メッセージ本文は一切保存しない。
 * detailにはcustomerId(UUID)とtitle(商品名 or 固定カテゴリ文言のみ)のみを入れる。
 * staffId は brain_ops_logs.actor_id 列(既存の意味と同じ「実行者」)に入れる。
 *
 * 認証: extractStaffFromRequest + canAccessCustomer (AUTH-2 準拠、他customer系APIと同型)
 */
import { NextRequest, NextResponse } from 'next/server'
import { idSchema, toValidationErrorResponse } from '../../../_schemas/common'
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest'
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer'
import { getRepos } from '../../../../lib/repos'
import { DEMO_STORE_ID } from '@/lib/constants'

const KIND_PREFIX = 'line_send:'
const VALID_KINDS = ['homecare', 'usage_card', 'thanks', 'follow'] as const
type LineSendKind = (typeof VALID_KINDS)[number]

interface LineSendLogEntry {
  kind:       LineSendKind
  title:      string
  occurredAt: string
}

function isValidKind(v: unknown): v is LineSendKind {
  return typeof v === 'string' && (VALID_KINDS as readonly string[]).includes(v)
}

export async function GET(
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

  const repos = getRepos()
  // store全体のline_send:*を新しい順にまとめて取得し、この顧客の分だけに絞る
  // (brain_ops_logsはkindに複合インデックスがあるがdetail->>customerIdには無いため、
  //  小規模サロン運用を前提に上限200件のアプリ側フィルタで賄う)。
  const rows = await repos.opsLogRepo.recentByStoreAndKindPrefix(DEMO_STORE_ID, KIND_PREFIX, 200)

  const logs: LineSendLogEntry[] = rows
    .filter(r => (r.detail as { customerId?: string })?.customerId === customerId)
    .map(r => ({
      kind:       r.kind.slice(KIND_PREFIX.length) as LineSendKind,
      title:      typeof (r.detail as { title?: unknown })?.title === 'string' ? (r.detail as { title: string }).title : '',
      occurredAt: r.createdAt,
    }))
    .slice(0, 20)

  return NextResponse.json({ success: true, logs })
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

  let body: { kind?: unknown; title?: unknown }
  try {
    body = await req.json() as { kind?: unknown; title?: unknown }
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_body' }, { status: 400 })
  }

  if (!isValidKind(body.kind) || typeof body.title !== 'string' || !body.title.trim()) {
    return NextResponse.json({ success: false, error: 'invalid_body' }, { status: 400 })
  }
  // titleはメッセージ本文ではなく短いラベル(商品名・固定カテゴリ文言)のみを想定(PIIゼロ契約)。
  const title = body.title.trim().slice(0, 60)

  const repos = getRepos()
  const inserted = await repos.opsLogRepo.insert({
    storeId: DEMO_STORE_ID,
    kind:    `${KIND_PREFIX}${body.kind}`,
    actorId: staff.staffBrainId,
    detail:  { customerId, title },
  })

  const log: LineSendLogEntry = {
    kind:       body.kind,
    title,
    occurredAt: inserted.createdAt,
  }

  return NextResponse.json({ success: true, log })
}
