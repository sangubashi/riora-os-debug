/**
 * commitCustomerPhotoRepo.supabase.ts
 * commitCustomerPhoto.ts の CommitCustomerPhotoRepo インターフェースのSupabase実装。
 *
 * service_role を使うため、呼び出し元(API route)で extractStaffFromRequest /
 * canAccessCustomer 等による認可チェックを行うこと(このモジュール自体は認可を
 * 行わない・DB/Storage操作のみに責務を絞る、commitVoiceMemoRepo.supabase.tsと同じ方針)。
 */
import { createClient } from '@supabase/supabase-js'
import { PHOTO_BUCKET } from './constants'
import type {
  CommitCustomerPhotoRepo,
  CustomerPhotoRecord,
  InsertPhotoResult,
  UploadPhotoResult,
} from './commitCustomerPhoto'

const SB_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

/** Postgres UNIQUE制約違反のSQLSTATE。 */
const PG_UNIQUE_VIOLATION = '23505'

export function createSupabaseCommitCustomerPhotoRepo(): CommitCustomerPhotoRepo {
  const sb = createClient(SB_URL, SVC_KEY)

  return {
    async findPhotoByStoragePath(storagePath: string): Promise<CustomerPhotoRecord | null> {
      const { data, error } = await sb
        .from('brain_customer_photos')
        .select('id, storage_path')
        .eq('storage_path', storagePath)
        .maybeSingle()

      if (error || !data) return null
      return { id: data.id as string, storagePath: data.storage_path as string }
    },

    async uploadPhoto(storagePath: string, file: Blob, opts: { upsert: boolean }): Promise<UploadPhotoResult> {
      const { error } = await sb.storage
        .from(PHOTO_BUCKET)
        .upload(storagePath, file, {
          contentType: file.type || 'image/webp',
          upsert:      opts.upsert,
        })

      if (!error) return { ok: true }

      const msg = error.message ?? String(error)
      // upsert:false での既存パス衝突は Supabase Storage が 409/"already exists" 系のメッセージを返す
      const conflict = !opts.upsert && /already exists|duplicate|409/i.test(msg)
      return { ok: false, conflict, error: msg }
    },

    // brain_customer_photos への insert はこの1箇所のみ(アプリ全体で唯一の書込み経路)
    async insertPhoto(row): Promise<InsertPhotoResult> {
      const { data, error } = await sb
        .from('brain_customer_photos')
        .insert({
          store_id:     row.storeId,
          customer_id:  row.customerId,
          visit_id:     row.visitId,
          body_part:    row.bodyPart,
          photo_type:   row.photoType,
          storage_path: row.storagePath,
          taken_at:     row.takenAt,
          created_by:   row.createdBy,
        })
        .select('id, storage_path')
        .single()

      if (error || !data) {
        const conflict = error?.code === PG_UNIQUE_VIOLATION
        return { ok: false, conflict, error: error?.message ?? 'unknown error' }
      }
      return { ok: true, record: { id: data.id as string, storagePath: data.storage_path as string } }
    },
  }
}
