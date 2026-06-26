/**
 * src/store/index.ts
 * 全ストアの再エクスポート
 */

// ── ストア ─────────────────────────────────────────────────────────────────
export { useDashboardStore } from './useDashboardStore'
export { useKpiStore }       from './useKpiStore'
export { useLineStore }      from './useLineStore'
export { useMenuStore }      from './useMenuStore'
export { useAuditStore }     from './useAuditStore'
export { useAuthStore }      from './useAuthStore'

// ── 型 ────────────────────────────────────────────────────────────────────
export type {
  AppScreen,
  UserRole,
  DashboardNotification,
  TodayReservation,
  LineUnreadItem,
} from './useDashboardStore'

export type {
  KpiKey,
  KpiSnapshot,
  AiInsight,
  WeeklyDatum,
  StaffRankItem,
} from './useKpiStore'

export type {
  LineThread,
  LineMessage,
  LineTemplate,
  TodayContact,
  Segment,
  LineCrmTab,
} from './useLineStore'

export type {
  MenuAnalyticsRow,
  MenuAnalyticsSummary,
  DailyRevenuePoint,
  FilterTab,
} from './useMenuStore'

export type {
  AuditScreen,
  AuditTableName,
  AuditAction,
  ExportType,
} from './useAuditStore'

export type { StaffInvitation } from './useAuthStore'

export { useStaffStore }    from './useStaffStore'
export { useCustomerStore } from './useCustomerStore'
export { useHomeStore }     from './useHomeStore'

// ── 後方互換エイリアス ────────────────────────────────────────────────────
export { useLineStore as useLineCrmStore } from './useLineStore'
