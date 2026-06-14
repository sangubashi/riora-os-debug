/**
 * POST /api/revisions/:id/approve (ApproveRevision)
 *
 * scope='store'はbrain_pattern_revisions、scope='brand'はbrain_revisionsを
 * status='proposed' -> 'approved'へ更新する。対象が存在しないか
 * status!='proposed'の場合は404を返す。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos } from '../../../../lib/repos';
import { idSchema, toValidationErrorResponse } from '../../../_schemas/common';
import { approveRevisionSchema } from '../../../_schemas/revision';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const parsed = approveRevisionSchema.safeParse(body);
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
    const revision = await repos.revisionRepo.approve(parsed.data.scope, idResult.data, parsed.data.decidedBy);
    if (!revision) {
      return NextResponse.json({ success: false, error: 'revision_not_found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, revision });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
