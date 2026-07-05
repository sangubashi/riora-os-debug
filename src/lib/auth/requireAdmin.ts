/**
 * requireAdmin.ts — admin@salon-riora.jp 専用ゲート
 *
 * extractStaffFromRequest() を利用し、未認証は401、スタッフアカウント
 * (isAdmin=false) は403を返す。既存の認証ロジック(extractStaffFromRequest /
 * isAdmin判定)は変更しない。
 *
 * 使い方:
 *   const gate = await requireAdmin(req);
 *   if (gate instanceof NextResponse) return gate;
 *   // ここから先は admin@salon-riora.jp として認証済み
 */
import { NextRequest, NextResponse } from 'next/server'
import { extractStaffFromRequest, type RequestingStaff } from './extractStaffFromRequest'

export async function requireAdmin(
  req: NextRequest
): Promise<RequestingStaff | NextResponse> {
  const staff = await extractStaffFromRequest(req)
  if (!staff) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 })
  }
  if (!staff.isAdmin) {
    return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 })
  }
  return staff
}
