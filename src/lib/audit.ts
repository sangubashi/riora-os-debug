/**
 * audit.ts – Audit log helpers
 * All functions are fire-and-forget and never throw.
 * Silently swallows errors to avoid disrupting the main UX flow.
 */
import { supabase } from './supabase'

/**
 * Record a customer profile view event.
 */
export async function logView(customerId: string): Promise<void> {
  try {
    await supabase.from('audit_view_logs').insert({
      customer_id: customerId,
    })
  } catch {
    // fire-and-forget: never throw
  }
}

/**
 * Record a customer data edit event with an optional diff payload.
 */
export async function logEdit(
  customerId: string,
  action: string,
  diff?: Record<string, unknown>
): Promise<void> {
  try {
    await supabase.from('audit_edit_logs').insert({
      customer_id: customerId,
      action,
      diff: diff ?? null,
    })
  } catch {
    // fire-and-forget: never throw
  }
}

/**
 * Record a CSV export event with record count and active filters.
 */
export async function logCsvExport(
  recordCount: number,
  filters?: Record<string, unknown>
): Promise<void> {
  try {
    await supabase.from('audit_csv_logs').insert({
      record_count: recordCount,
      filters: filters ?? null,
    })
  } catch {
    // fire-and-forget: never throw
  }
}
