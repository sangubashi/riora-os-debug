/**
 * PATCH/DELETE /api/admin/line/templates/[id] — テンプレート編集・削除(Pass G)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '../../../../../lib/repos';
import { updateTemplate, deleteTemplate } from '@/lib/line/lineAdminQueries';
import { templateIdParamSchema, templateUpdateSchema } from '../../../../_schemas/line';
import { toValidationErrorResponse } from '../../../../_schemas/common';
import { requireAdmin } from '@/lib/auth/requireAdmin';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  const idParsed = templateIdParamSchema.safeParse({ id });
  if (!idParsed.success) {
    return NextResponse.json(toValidationErrorResponse(idParsed.error), { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 });
  }

  const parsed = templateUpdateSchema.safeParse(body);
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
    const template = await updateTemplate(supabase, idParsed.data.id, parsed.data);
    return NextResponse.json({ success: true, template });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  const idParsed = templateIdParamSchema.safeParse({ id });
  if (!idParsed.success) {
    return NextResponse.json(toValidationErrorResponse(idParsed.error), { status: 400 });
  }

  let supabase;
  try {
    supabase = getServiceClient();
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }

  try {
    await deleteTemplate(supabase, idParsed.data.id);
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
