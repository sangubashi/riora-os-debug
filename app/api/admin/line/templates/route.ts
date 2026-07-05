/**
 * GET/POST /api/admin/line/templates — テンプレート管理(Pass G)
 *
 * line_templates/template_categories(実データ・マスタ)に接続。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '../../../../lib/repos';
import { listTemplates, createTemplate } from '@/lib/line/lineAdminQueries';
import { templateCreateSchema } from '../../../_schemas/line';
import { toValidationErrorResponse } from '../../../_schemas/common';
import { requireAdmin } from '@/lib/auth/requireAdmin';

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  let supabase;
  try {
    supabase = getServiceClient();
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }

  try {
    const templates = await listTemplates(supabase);
    return NextResponse.json({ success: true, templates });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 });
  }

  const parsed = templateCreateSchema.safeParse(body);
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
    const template = await createTemplate(supabase, parsed.data);
    return NextResponse.json({ success: true, template });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
