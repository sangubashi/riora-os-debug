import { isAdminRole } from "./roles";

export interface AuthContext {
  role: string;
  twoFactorEnabled?: boolean;
  staffId?: string;
}

export function assertAdminAccess(auth: AuthContext): void {
  if (!isAdminRole(auth.role)) {
    throw new Error("管理者（ADMIN）権限が必要です。全データアクセス、およびエクスポート権限は管理者のみです。");
  }
  if (!auth.twoFactorEnabled) {
    throw new Error("管理者（ADMIN）は2段階認証が必須です。");
  }
}

export function canAccessStaffData(auth: AuthContext, targetStaffId?: string): boolean {
  if (isAdminRole(auth.role)) return true;
  return !!(auth.staffId && targetStaffId && auth.staffId === targetStaffId);
}

export function assertStaffOwnData(auth: AuthContext, targetStaffId?: string): void {
  if (!canAccessStaffData(auth, targetStaffId)) {
    throw new Error("このデータへのアクセス権がありません。スタッフは自身の担当データのみ閲覧できます。");
  }
}
