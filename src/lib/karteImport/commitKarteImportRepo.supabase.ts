/**
 * commitKarteImportRepo.supabase.ts
 * commitKarteImport.ts の CommitKarteImportRepo インターフェースの Supabase実装。
 *
 * service_role を使うため、呼び出し元（API route）で extractStaffFromRequest +
 * canAccessCustomer による認可チェックを行うこと（このモジュール自体は認可を
 * 行わない・DB操作のみに責務を絞る、commitVoiceMemoRepo.supabase.ts と同じ方針）。
 */
import { createClient } from '@supabase/supabase-js'
import type { CommitKarteImportRepo } from './commitKarteImport'

const SB_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

export function createSupabaseCommitKarteImportRepo(): CommitKarteImportRepo {
  const sb = createClient(SB_URL, SVC_KEY)

  return {
    // karte_imports への insert はこの1箇所のみ（アプリ全体で唯一の書込み経路）
    async insertRawText(row): Promise<{ id: string }> {
      const { data, error } = await sb
        .from('karte_imports')
        .insert({
          customer_id: row.customerId,
          staff_id:    row.staffId,
          raw_text:    row.rawText,
        })
        .select('id')
        .single()

      if (error || !data) {
        throw new Error(`karte_imports insert failed: ${error?.message ?? 'unknown error'}`)
      }
      return { id: data.id as string }
    },

    // customer_notes への insert はこの1箇所のみ（カルテ取込由来・category=NULL固定）
    async insertNotes(rows): Promise<string[]> {
      if (rows.length === 0) return []

      const { data, error } = await sb
        .from('customer_notes')
        .insert(rows.map(r => ({
          customer_id: r.customerId,
          staff_id:    r.staffId,
          note:        r.content,
          category:    null,
          source:      'salonboard' as const,
        })))
        .select('id')

      if (error) {
        throw new Error(`customer_notes insert failed: ${error.message}`)
      }
      return (data ?? []).map(d => d.id as string)
    },

    // contraindications への insert はこの1箇所のみ（カルテ取込由来）
    async insertContraindications(rows): Promise<string[]> {
      if (rows.length === 0) return []

      const { data, error } = await sb
        .from('contraindications')
        .insert(rows.map(r => ({
          customer_id: r.customerId,
          severity:    r.severity,
          title:       r.title,
          description: r.description,
          source:      'salonboard',
        })))
        .select('id')

      if (error) {
        throw new Error(`contraindications insert failed: ${error.message}`)
      }
      return (data ?? []).map(d => d.id as string)
    },
  }
}
