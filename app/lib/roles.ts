export const ADMIN_DISPLAY_LABEL   = '管理者';
export const MANAGER_DISPLAY_LABEL = 'マネージャー';
export const STAFF_DISPLAY_LABEL   = 'スタッフ';

// DB制約(profiles.role CHECK (role IN ('owner','admin','staff')))と整合させるため
// 'admin' を正式値とする('manager' はDBに存在しない値だったため誤り)。
export const INTERNAL_ADMIN_ROLES = ["admin", "owner"] as const;
export type InternalAuthRole = typeof INTERNAL_ADMIN_ROLES[number] | "staff";
export type AppRole = "ADMIN" | "STAFF";

// 権限判定ロジック — 変更不可
export function isAdminRole(role: string): boolean {
  return INTERNAL_ADMIN_ROLES.includes(role as any);
}

export function getAppRole(role: string): AppRole {
  return isAdminRole(role) ? "ADMIN" : "STAFF";
}

// UI表示ラベル変換（owner/manager/staff の3階層対応）
// 'admin' は旧来のデモロール名として owner 扱いで継続サポート
export function getRoleDisplayName(role: string): string {
  switch (role) {
    case 'owner':
    case 'admin':
      return '管理者';
    case 'manager':
      return 'マネージャー';
    case 'staff':
    default:
      return 'スタッフ';
  }
}
