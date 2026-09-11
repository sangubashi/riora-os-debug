/**
 * canAccessCustomer.ts — 顧客カルテ閲覧アクセス判定
 *
 * 2026-09-11 ユーザー承認により、担当制によるカルテ閲覧制限(旧Rule A'/B'/C、AUTH-1 V2)は撤廃。
 * 全スタッフが全顧客のカルテを閲覧可能。「担当」表示自体(assignedStaffId/staffName等)は
 * 各APIルート側で従来どおり直近来店の担当スタッフから算出しており、本関数の変更による
 * 影響は受けない(閲覧可否と表示値の算出は元々独立している)。
 *
 * PHASE SECURITY-H1: is_internal_user=true(スタッフ本人の試用・検証購入等)の顧客は、
 * 上記の撤廃とは無関係に、管理者以外に対しては常にアクセス不可のまま維持する
 * (今回の担当制撤廃とは別目的の保護のため変更対象外)。
 * 設計根拠: docs/SECURITY_FINAL_AUDIT.md H-1。
 *
 * 注意: サーバーサイド専用（service role キー使用）
 */
import { createClient } from '@supabase/supabase-js'

const STORE_ID = '00000000-0000-0000-0000-000000000001'

function getServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase env not configured')
  return createClient(url, key, { auth: { persistSession: false } })
}

export async function canAccessCustomer(
  _staffBrainId: string | null,
  customerId:    string,
  isAdmin = false
): Promise<boolean> {
  if (isAdmin) return true

  const supabase = getServerClient()

  const { data: customer } = await supabase
    .from('brain_customers')
    .select('id, is_internal_user')
    .eq('id', customerId)
    .eq('store_id', STORE_ID)
    .is('deleted_at', null)
    .single()

  if (!customer) return false

  // PHASE SECURITY-H1: 内部ユーザーは常に除外する(担当制撤廃とは別目的の保護)。
  if ((customer as { is_internal_user?: boolean }).is_internal_user) return false

  // 担当制撤廃(2026-09-11): 内部ユーザーでなければ全スタッフが閲覧可能。
  return true
}

/**
 * 顧客リスト用: アクセス可能な顧客 ID セットを一括取得
 * canAccessCustomer を個別に N 回呼ぶより高速
 */
export async function filterAccessibleCustomerIds(
  customerIds: string[],
  _staffBrainId: string | null,
  isAdmin: boolean
): Promise<Set<string>> {
  if (isAdmin) return new Set(customerIds)
  if (customerIds.length === 0) return new Set()

  const supabase = getServerClient()

  const { data: customers } = await supabase
    .from('brain_customers')
    .select('id, is_internal_user')
    .in('id', customerIds)
    .eq('store_id', STORE_ID)
    .is('deleted_at', null)

  if (!customers || customers.length === 0) return new Set()

  // PHASE SECURITY-H1: 内部ユーザーは候補から除外する(canAccessCustomerと同じ共通ゲート)。
  // 担当制撤廃(2026-09-11): 残りは全て閲覧可能(旧Rule A'/B'/Cによる絞り込みは行わない)。
  const validIds = customers
    .filter(c => !(c as { is_internal_user?: boolean }).is_internal_user)
    .map(c => c.id)

  return new Set(validIds)
}
