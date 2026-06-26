/**
 * GET /api/admin/line/threads/[recipientId] — 顧客別トーク詳細(Pass G)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '../../../../../lib/repos';
import { getLineThreadMessages } from '@/lib/line/lineAdminQueries';
import { recipientIdParamSchema } from '../../../../_schemas/line';
import { toValidationErrorResponse } from '../../../../_schemas/common';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ recipientId: string }> }) {
  const { recipientId } = await params;
  const parsed = recipientIdParamSchema.safeParse({ recipientId });
  if (!parsed.success) {
    return NextResponse.json(toValidationErrorResponse(parsed.error), { status: 400 });
  }

  let supabase;
  try {
    supabase = getServiceClient();
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }

  try {
    const messages = await getLineThreadMessages(supabase, parsed.data.recipientId);
    return NextResponse.json({ success: true, recipientId: parsed.data.recipientId, messages });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
