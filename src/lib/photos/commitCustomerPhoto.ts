/**
 * commitCustomerPhoto.ts
 * brain_customer_photos への書込み(アップロード)の唯一の経路。
 *
 * 設計: docs/PHOTO_KARTE_API_DESIGN_1.md 2節・10節・11節、
 *   docs/PHOTO_KARTE_MIGRATION_DESIGN_1.md 8節
 *
 * src/lib/voice/commitVoiceMemo.ts と同じ設計思想(Single Write Path +
 * clientRequestId起点の決定的storage_pathによる冪等性)を写真用に踏襲する。
 *
 * DB/Storageアクセスは CommitCustomerPhotoRepo インターフェース経由に閉じ込め、
 * オーケストレーション本体は依存注入されたrepoのフェイクだけで純粋にテストできる。
 */

// ─── 公開型 ──────────────────────────────────────────────────────────────────

export interface CommitCustomerPhotoPayload {
  storeId:      string
  customerId:   string
  /** brain_visits.id。単発撮影の場合は null。 */
  visitId:      string | null
  bodyPart:     string
  photoType:    'before' | 'after' | 'progress'
  /** 撮影日時。省略時は呼び出し側(API route)がnow()相当を渡す。 */
  takenAt:      string
  /** brain_staff.id。auth.users.idではない(PHOTO_KARTE_API_DESIGN_1.md 5-1節)。 */
  createdBy:    string | null
  file:         Blob
}

export interface CustomerPhotoRecord {
  id:          string
  storagePath: string
}

export type UploadPhotoResult =
  | { ok: true }
  | { ok: false; conflict: boolean; error: string }

export type InsertPhotoResult =
  | { ok: true; record: CustomerPhotoRecord }
  | { ok: false; conflict: boolean; error: string }

/**
 * commitCustomerPhoto が必要とする永続化操作の最小インターフェース。
 * 実装は Supabase 版(createSupabaseCommitCustomerPhotoRepo)を想定するが、
 * テストでは in-memory フェイクを注入する。
 */
export interface CommitCustomerPhotoRepo {
  /** 決定的 storage_path から既存行を検索(冪等性チェック) */
  findPhotoByStoragePath(storagePath: string): Promise<CustomerPhotoRecord | null>
  /** Storage へアップロード。upsert指定可(孤児オブジェクト救済用、API設計11節参照) */
  uploadPhoto(storagePath: string, file: Blob, opts: { upsert: boolean }): Promise<UploadPhotoResult>
  /**
   * brain_customer_photos への insert(このRepo実装内で唯一の書込み経路)。
   * storage_path の UNIQUE制約違反(23505)は conflict:true として返すこと
   * (真の同時実行競合に対するDB側の最終防波堤、MIGRATION_DESIGN_1.md 8節)。
   */
  insertPhoto(row: {
    storeId:      string
    customerId:   string
    visitId:      string | null
    bodyPart:     string
    photoType:    'before' | 'after' | 'progress'
    storagePath:  string
    takenAt:      string
    createdBy:    string | null
  }): Promise<InsertPhotoResult>
}

export type CommitCustomerPhotoResult =
  | { ok: true;  idempotent: boolean; photo: CustomerPhotoRecord }
  | { ok: false; reason: string }

// ─── storage_path の決定的生成(clientRequestIdによる冪等性の核) ────────────
//
// PHOTO_KARTE_API_DESIGN_1.md 10節: photo_id(DB生成)ではなくclientRequestIdを
// ファイル名に使う。アップロード時点ではDB行がまだ存在しないため。
export function buildPhotoStoragePath(
  storeId:         string,
  customerId:      string,
  clientRequestId: string,
): string {
  return `${storeId}/${customerId}/${clientRequestId}.webp`
}

// ─── オーケストレーション本体 ─────────────────────────────────────────────────

export async function commitCustomerPhoto(
  repo:            CommitCustomerPhotoRepo,
  payload:         CommitCustomerPhotoPayload,
  clientRequestId: string,
): Promise<CommitCustomerPhotoResult> {
  const storagePath = buildPhotoStoragePath(payload.storeId, payload.customerId, clientRequestId)

  // ── 冪等性チェック: 同一clientRequestIdで既にコミット済みなら何も書かず終える ──
  const existing = await repo.findPhotoByStoragePath(storagePath)
  if (existing) {
    return { ok: true, idempotent: true, photo: existing }
  }

  // ── Storage アップロード(upsert:false・pathはclientRequestId由来で決定的) ──
  let upload = await repo.uploadPhoto(storagePath, payload.file, { upsert: false })
  if (!upload.ok) {
    if (!upload.conflict) {
      return { ok: false, reason: `storage_upload_failed:${upload.error}` }
    }

    // 衝突: 同時に同一clientRequestIdで呼ばれたリクエストが先着した可能性 → 再確認
    const raced = await repo.findPhotoByStoragePath(storagePath)
    if (raced) {
      return { ok: true, idempotent: true, photo: raced }
    }

    // DBに行が無いのにStorageには存在する = 真の孤児(過去のDB INSERT失敗の残骸)。
    // API設計11節の「案A」: upsert:trueで上書きしてから仕切り直す。
    upload = await repo.uploadPhoto(storagePath, payload.file, { upsert: true })
    if (!upload.ok) {
      return { ok: false, reason: `storage_upload_failed:${upload.error}` }
    }
  }

  // ── brain_customer_photos insert(唯一の書込み経路) ──
  const inserted = await repo.insertPhoto({
    storeId:     payload.storeId,
    customerId:  payload.customerId,
    visitId:     payload.visitId,
    bodyPart:    payload.bodyPart,
    photoType:   payload.photoType,
    storagePath,
    takenAt:     payload.takenAt,
    createdBy:   payload.createdBy,
  })

  if (!inserted.ok) {
    if (inserted.conflict) {
      // UNIQUE(storage_path)違反 = 真の同時実行競合(MIGRATION_DESIGN_1.md 8節)。
      // 自分は敗者だった → 勝者の行を検索して冪等応答に合流する。
      const winner = await repo.findPhotoByStoragePath(storagePath)
      if (winner) {
        return { ok: true, idempotent: true, photo: winner }
      }
    }
    return { ok: false, reason: `db_insert_failed:${inserted.error}` }
  }

  return { ok: true, idempotent: false, photo: inserted.record }
}
