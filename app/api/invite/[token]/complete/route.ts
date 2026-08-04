/**
 * POST /api/invite/[token]/complete — 招待経由スタッフ初回登録の完了(STAFF_MANAGEMENT_PHASE2_2)
 *
 * 認証不要(招待トークン自体が認可)。処理順序(6章の実行順):
 *   ① staff_invites.used_at をこの時点で先に消費(atomic UPDATE ... WHERE used_at IS NULL)。
 *      同一トークンでの二重登録(同時押し等)を、auth.users作成より前に確実に防ぐため
 *      consumeを一番先に行う(先にauth.usersを作ってから消費すると、同時に2リクエスト
 *      来た場合に2つのauth.users+brain_staffが作られてしまうレースが起こり得るため)。
 *   ② supabase.auth.admin.createUser() で auth.users を作成 → authUid取得
 *   ③ StaffRepo.create() → provision_staff() RPC(profiles+brain_staffを単一トランザクション作成)
 *
 * ②または③が失敗した場合、招待は既に消費済みのまま残る(同じ招待での再試行は不可・
 * 管理者が新しい招待を発行し直す運用を前提とする。招待を"使い捨てにしない"設計は
 * 複雑になるため見送った・7章「リスク評価」参照)。③が失敗した場合は②で作成した
 * auth.usersを可能な限りロールバック(削除)する(孤立auth.usersを残さないため)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos, getServiceClient } from '../../../../lib/repos';
import { completeInviteBodySchema } from '../../../_schemas/staffInvite';
import { idSchema, toValidationErrorResponse } from '../../../_schemas/common';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const tokenResult = idSchema.safeParse(token);
  if (!tokenResult.success) {
    return NextResponse.json(toValidationErrorResponse(tokenResult.error), { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 });
  }
  const parsed = completeInviteBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(toValidationErrorResponse(parsed.error), { status: 400 });
  }

  let repos;
  try {
    repos = getRepos();
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }

  // 事前チェック(消費はまだしない)。期限切れ・使用済みならここで弾く。
  let precheck;
  try {
    precheck = await repos.inviteRepo.validateInvite(tokenResult.data);
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
  if (!precheck) {
    return NextResponse.json({ success: false, error: 'invite_not_found' }, { status: 404 });
  }
  if (precheck.usedAt !== null) {
    return NextResponse.json({ success: false, error: 'invite_already_used' }, { status: 409 });
  }
  if (new Date(precheck.expiresAt).getTime() < Date.now()) {
    return NextResponse.json({ success: false, error: 'invite_expired' }, { status: 410 });
  }

  // ① 消費(atomic)。事前チェックと消費の間に競合した場合はここでnullになる。
  let invite;
  try {
    invite = await repos.inviteRepo.consumeInvite(tokenResult.data);
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
  if (!invite) {
    return NextResponse.json({ success: false, error: 'invite_already_used' }, { status: 409 });
  }

  // ② auth.users作成
  const serviceClient = getServiceClient();
  const { data: authData, error: authError } = await serviceClient.auth.admin.createUser({
    email: invite.email,
    password: parsed.data.password,
    email_confirm: true,
  });

  if (authError || !authData.user) {
    return NextResponse.json(
      { success: false, error: `auth_create_failed: ${authError?.message ?? 'unknown'}` },
      { status: 500 }
    );
  }
  const authUid = authData.user.id;

  // ③ profiles + brain_staff(単一トランザクション)
  try {
    const staff = await repos.staffRepo.create({
      authUid,
      name: invite.staffName,
      storeId: invite.storeId,
      role: invite.role,
    });

    return NextResponse.json({ success: true, staffId: staff.id, email: invite.email });
  } catch (e) {
    // 孤立auth.usersを残さないためのベストエフォート・ロールバック。
    try {
      await serviceClient.auth.admin.deleteUser(authUid);
    } catch (cleanupError) {
      console.error('[invite/complete] auth.users rollback failed:', cleanupError);
    }
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
