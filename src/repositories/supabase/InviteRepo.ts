/**
 * InviteRepo.ts — staff_invites(STAFF_MANAGEMENT_PHASE2_2)のRepository実装。
 *
 * 招待トークンはDBに平文保存しない。生トークン(inviteLink.generateInviteToken()が
 * 生成しURLに埋め込む値)はsha256でハッシュ化してからstaff_invites.tokenへ保存し、
 * 検証時も入力トークンを同じ方式でハッシュ化してから照合する(生トークンをDB読み取り
 * だけで盗めないようにするための一般的な設計・招待トークンは256bitのランダム値のため
 * 追加のsaltは不要)。
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import type { StaffInvite } from '../../types/riora.types';
import type { CreateInviteInput, IInviteRepo } from '../interfaces';
import { toStaffInvite, type StaffInviteRow } from './mappers';

const INVITE_COLUMNS = 'id, store_id, role, staff_name, email, expires_at, used_at, created_at';
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7日

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

export class InviteRepo implements IInviteRepo {
  constructor(private readonly client: SupabaseClient) {}

  async createInvite(input: CreateInviteInput, rawToken: string): Promise<StaffInvite> {
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();

    const { data, error } = await this.client
      .from('staff_invites')
      .insert({
        token: hashToken(rawToken),
        store_id: input.storeId,
        role: input.role,
        staff_name: input.staffName,
        email: input.email,
        expires_at: expiresAt,
      })
      .select(INVITE_COLUMNS)
      .single();

    if (error) {
      throw new Error(`InviteRepo.createInvite failed: ${error.message}`);
    }
    return toStaffInvite(data as unknown as StaffInviteRow);
  }

  async validateInvite(rawToken: string): Promise<StaffInvite | null> {
    const { data, error } = await this.client
      .from('staff_invites')
      .select(INVITE_COLUMNS)
      .eq('token', hashToken(rawToken))
      .maybeSingle();

    if (error) {
      throw new Error(`InviteRepo.validateInvite failed: ${error.message}`);
    }
    if (!data) return null;
    return toStaffInvite(data as unknown as StaffInviteRow);
  }

  async consumeInvite(rawToken: string): Promise<StaffInvite | null> {
    const { data, error } = await this.client
      .from('staff_invites')
      .update({ used_at: new Date().toISOString() })
      .eq('token', hashToken(rawToken))
      .is('used_at', null)
      .select(INVITE_COLUMNS)
      .maybeSingle();

    if (error) {
      throw new Error(`InviteRepo.consumeInvite failed: ${error.message}`);
    }
    if (!data) return null;
    return toStaffInvite(data as unknown as StaffInviteRow);
  }
}
