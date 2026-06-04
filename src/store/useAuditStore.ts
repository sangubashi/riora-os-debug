/**
 * useAuditStore  –  軽量監査ログ クライアントストア（MVP）
 *
 * 3種の監査ログを Supabase に書き込む。失敗しても UI を壊さない（silent fail）。
 *  ① logView   – 顧客画面を開いた記録
 *  ② logEdit   – メモ/タグ/ログ/予約を変更した記録（before/after JSON）
 *  ③ logExport – CSV等の一括エクスポート記録
 *
 * アクセス制限: audit_* テーブルは owner ロールのみ SELECT 可能（RLS）。
 * 一般スタッフは INSERT のみ（自分のログを書く）。読み取り不可。
 */
import { create } from 'zustand'
import { supabase } from '@/lib/supabase'

// ─── 型 ──────────────────────────────────────────────────────────────────────

export type AuditScreen =
  | 'customer_detail'
  | 'customer_page'
  | 'ai_proposal'
  | 'service_log'
  | 'line_chat'
  | 'kpi_dashboard'
  | 'menu_management'

export type AuditTableName =
  | 'staff_logs'
  | 'reservations'
  | 'customers'
  | 'line_messages'
  | 'salon_menus'

export type AuditAction = 'INSERT' | 'UPDATE' | 'DELETE'

export type ExportType =
  | 'customer_list'
  | 'sales_csv'
  | 'line_history'
  | 'kpi_report'
  | 'staff_log'

interface AuditStore {
  /**
   * ① 顧客画面を開いた記録
   *    → audit_view_logs に INSERT
   */
  logView: (params: {
    customerId: string
    screen?:    AuditScreen
    staffId?:   string
  }) => Promise<void>

  /**
   * ② データ変更の記録（メモ・タグ・ログ・予約）
   *    → audit_edit_logs に INSERT（before/after を JSON で保存）
   */
  logEdit: (params: {
    tableName:  AuditTableName
    recordId:   string
    action:     AuditAction
    beforeData: Record<string, unknown> | null
    afterData:  Record<string, unknown> | null
    staffId?:   string
  }) => Promise<void>

  /**
   * ③ エクスポート操作の記録
   *    → audit_export_logs に INSERT
   */
  logExport: (params: {
    exportType:  ExportType
    recordCount: number
    filters?:    Record<string, unknown>
    staffId?:    string
  }) => Promise<void>
}

// ─── Supabase RPC ヘルパー ────────────────────────────────────────────────────

async function getStaffId(override?: string): Promise<string> {
  if (override) return override
  // Supabase auth から取得。未ログイン時は 'anonymous'
  const { data } = await supabase.auth.getUser()
  return data.user?.id ?? 'anonymous'
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useAuditStore = create<AuditStore>(() => ({

  // ①
  logView: async ({ customerId, screen = 'customer_detail', staffId }) => {
    try {
      const userId = await getStaffId(staffId)
      await supabase.from('audit_view_logs').insert({
        user_id:     userId,
        customer_id: customerId,
        screen,
        viewed_at:   new Date().toISOString(),
      })
    } catch { /* silent fail */ }
  },

  // ②
  logEdit: async ({ tableName, recordId, action, beforeData, afterData, staffId }) => {
    try {
      const userId = await getStaffId(staffId)
      await supabase.from('audit_edit_logs').insert({
        user_id:     userId,
        table_name:  tableName,
        record_id:   recordId,
        action,
        before_data: beforeData ?? null,
        after_data:  afterData  ?? null,
        edited_at:   new Date().toISOString(),
      })
    } catch { /* silent fail */ }
  },

  // ③
  logExport: async ({ exportType, recordCount, filters = {}, staffId }) => {
    try {
      const userId = await getStaffId(staffId)
      await supabase.from('audit_export_logs').insert({
        user_id:      userId,
        export_type:  exportType,
        record_count: recordCount,
        filters:      filters,
        exported_at:  new Date().toISOString(),
      })
    } catch { /* silent fail */ }
  },
}))
