/**
 * POST /api/admin/knowledge-import/preview (KNOWLEDGE_IMPORT_PHASE1 — 管理者専用)
 *
 * CSVをパース・検証するだけのdry-run。DBへは一切書き込まない。
 * LLM・外部API連携は行わない(CSVの内容をそのまま検証するのみ)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { knowledgeImportPreviewBodySchema } from '../../../_schemas/knowledgeImport';
import { toValidationErrorResponse } from '../../../_schemas/common';
import { parseKnowledgeImportCsv } from '@/lib/import/knowledgeCsvParser';

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 });
  }

  const parsed = knowledgeImportPreviewBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(toValidationErrorResponse(parsed.error), { status: 400 });
  }

  const result = parseKnowledgeImportCsv(parsed.data.csvText);
  if (result.headerError) {
    return NextResponse.json({ success: false, error: result.headerError }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    validRows: result.validRows,
    skippedRows: result.skippedRows,
    totalLines: result.totalLines,
  });
}
