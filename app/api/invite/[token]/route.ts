/**
 * GET /api/invite/[token] — 招待トークンの有効性検証(STAFF_MANAGEMENT_PHASE2_2)
 *
 * 認証不要(招待された本人がまだアカウントを持たない前提のため)。トークンで
 * 招待を検証するだけの読み取り専用API。expires_at/used_atの判定はここで行い、
 * app/invite/[token]/page.tsxが結果を表示する。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos } from '../../../lib/repos';
import { idSchema, toValidationErrorResponse } from '../../_schemas/common';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const tokenResult = idSchema.safeParse(token);
  if (!tokenResult.success) {
    return NextResponse.json(toValidationErrorResponse(tokenResult.error), { status: 400 });
  }

  let repos;
  try {
    repos = getRepos();
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }

  try {
    const invite = await repos.inviteRepo.validateInvite(tokenResult.data);
    if (!invite) {
      return NextResponse.json({ success: false, error: 'invite_not_found' }, { status: 404 });
    }

    const isUsed = invite.usedAt !== null;
    const isExpired = new Date(invite.expiresAt).getTime() < Date.now();
    const status = isUsed ? 'used' : isExpired ? 'expired' : 'valid';

    return NextResponse.json({
      success: true,
      status,
      staffName: invite.staffName,
      email: invite.email,
      role: invite.role,
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
