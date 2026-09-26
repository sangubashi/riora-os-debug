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
    // 【重要・デプロイ前提条件】thumbnail_storage_path列は2026-09-26付けmigration
    // (supabase/migrations/20260926000000_brain_customer_photos_thumbnail.sql)で
    // 追加される想定で、今回のセッションでは未適用(実行禁止のため)。この列名を含む
    // 本SELECT(commitCustomerPhoto()が全ての写真コミットで呼ぶ冪等性チェック)は、
    // 当該migrationを本番へ適用する前にこのコードをデプロイすると列不存在エラーで
    // 失敗し、写真アップロード機能全体(サムネイルだけでなく原本も)が壊れる。
    // 必ず migration適用 → このコードのデプロイ、の順序を守ること。
    async findPhotoByStoragePath(storagePath: string): Promise<CustomerPhotoRecord | null> {
      const { data, error } = await sb
        .from('brain_customer_photos')
        .select('id, storage_path, thumbnail_storage_path')
        .eq('storage_path', storagePath)
        .maybeSingle()

      if (error || !data) return null
      return {
        id:                   data.id as string,
        storagePath:          data.storage_path as string,
        thumbnailStoragePath: (data.thumbnail_storage_path as string | null) ?? null,
      }
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

    // 写真サムネイル機能③(2026-09-26ユーザー承認): サムネイル専用のStorageアップロード。
    // uploadPhoto()と処理内容はほぼ同じだが、呼び出し側(commitCustomerPhoto.ts)が
    // 「失敗してもcommitCustomerPhoto全体は成功のまま」という前提で扱うため、
    // 意味を明確にするため別メソッドとして分離する。
    async uploadThumbnail(storagePath: string, file: Blob, opts: { upsert: boolean }): Promise<UploadPhotoResult> {
      const { error } = await sb.storage
        .from(PHOTO_BUCKET)
        .upload(storagePath, file, {
          contentType: file.type || 'image/webp',
          upsert:      opts.upsert,
        })

      if (!error) return { ok: true }

      const msg = error.message ?? String(error)
      const conflict = !opts.upsert && /already exists|duplicate|409/i.test(msg)
      return { ok: false, conflict, error: msg }
    },

    // 写真サムネイル機能③: 原本insert後にthumbnail_storage_pathのみを更新する。
    // 【重要】このカラムは2026-09-26付けmigration(20260926000000_brain_customer_
    // photos_thumbnail.sql)で追加される想定。当該migrationを本番へ適用する前に
    // このコードをデプロイすると、本メソッド(および下記findPhotoByStoragePathの
    // SELECT)が列不存在エラーで失敗する点に注意(commitCustomerPhoto.ts側は
    // 例外を捕捉して非致命的に扱うため原本保存自体は壊れないが、サムネイルは
    // 常に保存されない状態になる)。
    async setThumbnailPath(photoId: string, thumbnailStoragePath: string): Promise<{ ok: boolean; error?: string }> {
      const { error } = await sb
        .from('brain_customer_photos')
        .update({ thumbnail_storage_path: thumbnailStoragePath })
        .eq('id', photoId)

      if (error) return { ok: false, error: error.message }
      return { ok: true }
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
