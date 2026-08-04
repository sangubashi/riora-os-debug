/**
 * POST /api/admin/staff/invite — スタッフ招待発行(STAFF_MANAGEMENT_PHASE2_2)
 *
 * requireAdmin必須。staff_invitesへ1件作成し、招待URL(/invite/{token})を返す。
 * auth.users・profiles・brain_staffの作成はここでは行わない(招待を受け取った
 * 本人が /invite/[token] で登録を完了した時点で初めて作成される・6章参照)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos } from '../../../../lib/repos';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { createInviteBodySchema } from '../../../_schemas/staffInvite';
import { toValidationErrorResponse } from '../../../_schemas/common';
import { generateInviteToken, buildInviteUrl } from '@/lib/staffInvite/inviteLink';
import { DEMO_STORE_ID } from '@/lib/constants';

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 });
  }

  const parsed = createInviteBodySchema.safeParse(body);
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
    const rawToken = generateInviteToken();
    const invite = await repos.inviteRepo.createInvite(
      {
        storeId: DEMO_STORE_ID,
        role: parsed.data.role,
        staffName: parsed.data.staff_name,
        email: parsed.data.email,
      },
      rawToken
    );

    const inviteUrl = buildInviteUrl(rawToken, req.nextUrl.origin);

    return NextResponse.json({
      success: true,
      inviteId: invite.id,
      inviteUrl,
      expiresAt: invite.expiresAt,
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
