/**
 * POST /api/line-queue/:id/approve (ApproveLineSend)
 *
 * brain_line_send_queue.statusを更新する(承認/却下/送信済等)。
 * LINE実送信(line/sender)は本Stepの対象外(Repository経由のみ)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos } from '../../../../lib/repos';
import { idSchema, toValidationErrorResponse } from '../../../_schemas/common';
import { updateLineQueueStatusSchema } from '../../../_schemas/lineQueue';
import { requireAdmin } from '@/lib/auth/requireAdmin';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;

  const idResult = idSchema.safeParse(id);
  if (!idResult.success) {
    return NextResponse.json(toValidationErrorResponse(idResult.error), { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 });
  }

  const parsed = updateLineQueueStatusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(toValidationErrorResponse(parsed.error), { status: 400 });
  }

  let repos;
  try {
    repos = getRepos();
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }

  try {
    const item = await repos.lineQueueRepo.updateStatus(idResult.data, parsed.data.status);
    if (!item) {
      return NextResponse.json({ success: false, error: 'queue_item_not_found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, item });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
