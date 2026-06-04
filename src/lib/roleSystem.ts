/**
 * roleSystem.ts  — PHASE 7
 * staff / manager / admin の権限分離。
 * 既存 UserRole（owner/admin/staff/null）に manager を追加。
 *
 * Demo Mode:
 *   DEMO_MODE=true または ?demo=1 クエリパラメータで有効化。
 *   本番Supabase に触れずにガイドフローを実演できる。
 */

import { DEMO_MODE } from '@/lib/supabase'
import type { UserRole } from '@/store/useDashboardStore'

// ─── 権限定義 ─────────────────────────────────────────────────────────────────

/** 権限レベル（数値が大きいほど広い権限） */
const ROLE_LEVEL: Record<NonNullable<UserRole>, number> = {
  owner: 4,
  admin: 3,
  staff: 1,
}

export type Permission =
  | 'view_kpi'            // KPI閲覧
  | 'view_all_customers'  // 全顧客閲覧
  | 'edit_customer'       // 顧客情報編集
  | 'send_line'           // LINE送信
  | 'manage_staff'        // スタッフ管理
  | 'view_staff_flow'     // スタッフ強み分析閲覧
  | 'export_data'         // データエクスポート
  | 'demo_reset'          // デモリセット

const PERMISSIONS: Record<Permission, NonNullable<UserRole>[]> = {
  view_kpi:           ['owner', 'admin', 'staff'],
  view_all_customers: ['owner', 'admin'],
  edit_customer:      ['owner', 'admin', 'staff'],
  send_line:          ['owner', 'admin', 'staff'],
  manage_staff:       ['owner'],
  view_staff_flow:    ['owner', 'admin'],
  export_data:        ['owner'],
  demo_reset:         ['owner', 'admin'],
}

export function hasPermission(role: UserRole, permission: Permission): boolean {
  if (!role) return false
  return PERMISSIONS[permission].includes(role as NonNullable<UserRole>)
}

export function requireRole(role: UserRole, minRole: NonNullable<UserRole>): boolean {
  if (!role) return false
  return (ROLE_LEVEL[role as NonNullable<UserRole>] ?? 0) >= ROLE_LEVEL[minRole]
}

// ─── Demo Mode ────────────────────────────────────────────────────────────────

/** Demo Mode 判定（DEMO_MODE env または URL query） */
export function isDemoMode(): boolean {
  if (DEMO_MODE) return true
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('demo') === '1'
}

/** Demo Mode 用フェイク顧客データ */
export const DEMO_CUSTOMERS = [
  {
    id:                   'demo-c1',
    name:                 '田中 美咲',
    visits:               8,
    visit_count:          8,
    total_sales:          96000,
    avg_price:            12000,
    last_visit:           '2026-05-01',
    customer_type:        '効果重視型' as const,
    vip_rank:             2,
    churn_risk:           35,
    line_response_rate:   92,
    next_visit_prediction: '2026-05-29',
    skin_tags:            ['dry', 'pigmentation'] as const,
    recommended_cycle_days: 28,
  },
  {
    id:                   'demo-c2',
    name:                 '佐藤 明子',
    visits:               14,
    visit_count:          14,
    total_sales:          168000,
    avg_price:            12000,
    last_visit:           '2026-04-08',
    customer_type:        '感情重視型' as const,
    vip_rank:             3,
    churn_risk:           68,
    line_response_rate:   45,
    next_visit_prediction: '2026-05-08',
    skin_tags:            ['sensitive', 'redness'] as const,
    recommended_cycle_days: 42,
  },
  {
    id:                   'demo-c3',
    name:                 '高橋 由美子',
    visits:               24,
    visit_count:          24,
    total_sales:          432000,
    avg_price:            18000,
    last_visit:           '2026-05-10',
    customer_type:        'VIP型' as const,
    vip_rank:             5,
    churn_risk:           12,
    line_response_rate:   100,
    next_visit_prediction: '2026-06-01',
    skin_tags:            ['aging', 'dry'] as const,
    recommended_cycle_days: 45,
  },
]

/** Demo Mode リセット関数 */
export function resetDemoState(): void {
  // Zustand ストアのリセットは各 store の reset アクションに委譲
  // ここでは localStorage のデモ関連キーをクリア
  if (typeof window === 'undefined') return
  try {
    const keys = Object.keys(localStorage).filter(k => k.startsWith('riora_demo_'))
    keys.forEach(k => localStorage.removeItem(k))
  } catch { /* Safari ITP: localStorage blocked — silent */ }
  console.log('[DemoMode] リセット完了')
}

/** ガイドフロー定義（デモ時のステップ案内） */
export const DEMO_GUIDED_STEPS = [
  { step: 1, label: '予約一覧を確認',    hint: '今日の予約3名が並んでいます' },
  { step: 2, label: '田中様をタップ',    hint: 'VIP候補のお客様です' },
  { step: 3, label: 'AIコンテキスト確認', hint: '関係性・リスク・提案を確認' },
  { step: 4, label: 'LINE下書きをコピー', hint: '1タップでクリップボードへ' },
  { step: 5, label: '実施済みを記録',     hint: '5種類のアクションを記録' },
  { step: 6, label: '音声メモを録音',     hint: '接客後の所感を30秒で録音' },
  { step: 7, label: '接客ログを保存',     hint: '接客リプレイが自動表示されます' },
]
