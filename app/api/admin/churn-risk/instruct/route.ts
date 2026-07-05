/**
 * POST /api/admin/churn-risk/instruct (画面②離脱予兆センター・MD-2「担当スタッフへ指示」)
 *
 * 管理者は閲覧と指示のみ(ユーザー指示・2026-06-23): LINE送信・予約操作は一切行わない。
 * brain_ops_logs(kind='churn_instruction')に記録するだけの監査ログ書込であり、
 * LINE送信(brain_line_send_queue)や予約(brain_bookings)には触れない。
 * brain_ops_logsは汎用運用ログとして設計されており(20260621_csv_import_security_diff.sql
 * COMMENT ON TABLE参照)、新規業務テーブルを追加せずkindを追加するだけで対応できる。
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getRepos } from '../../../../lib/repos';
import { toValidationErrorResponse } from '../../../_schemas/common';
import { requireAdmin } from '@/lib/auth/requireAdmin';

const postBodySchema = z.object({
  storeId: z.string().min(1),
  customerId: z.string().min(1),
  staffId: z.string().min(1),
  note: z.string().min(1).max(500),
});

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 });
  }

  const parsed = postBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(toValidationErrorResponse(parsed.error), { status: 400 });
  }
  const { storeId, customerId, staffId, note } = parsed.data;

  let repos;
  try {
    repos = getRepos();
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }

  try {
    const [customer, staff] = await Promise.all([
      repos.customerRepo.findById(customerId),
      repos.staffRepo.listByStore(storeId),
    ]);

    if (!customer || customer.storeId !== storeId) {
      return NextResponse.json({ success: false, error: 'customer_not_found' }, { status: 404 });
    }
    if (!staff.some((s) => s.id === staffId)) {
      return NextResponse.json({ success: false, error: 'staff_not_found' }, { status: 404 });
    }

    const log = await repos.opsLogRepo.insert({
      storeId,
      kind: 'churn_instruction',
      actorId: null,
      detail: { customerId, staffId, note },
    });

    return NextResponse.json({ success: true, instructionId: log.id, createdAt: log.createdAt });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
