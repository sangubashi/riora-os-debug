export const ADMIN_DISPLAY_LABEL = "管理者（ADMIN）";
export const STAFF_DISPLAY_LABEL = "スタッフ";

export const INTERNAL_ADMIN_ROLES = ["manager", "owner"] as const;
export type InternalAuthRole = typeof INTERNAL_ADMIN_ROLES[number] | "staff";
export type AppRole = "ADMIN" | "STAFF";

export function isAdminRole(role: string): boolean {
  return INTERNAL_ADMIN_ROLES.includes(role as any);
}

export function getAppRole(role: string): AppRole {
  return isAdminRole(role) ? "ADMIN" : "STAFF";
}

export function getRoleDisplayName(role: string): string {
  return isAdminRole(role) ? ADMIN_DISPLAY_LABEL : STAFF_DISPLAY_LABEL;
}
