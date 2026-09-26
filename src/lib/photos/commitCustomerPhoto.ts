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
 *
 * WebP/JPEGフォールバック対応(実機テストでiOS SafariのWebP非対応が判明後の改訂):
 * storage_pathの拡張子は、クライアントから受け取ったファイル名ではなく、
 * サーバー側で実際に検証済みの payload.file.type(呼び出し元route.tsが
 * ALLOWED_PHOTO_MIME_TYPESで検証済み)から決定する。
 */
import { PHOTO_MIME_EXTENSIONS, type AllowedPhotoMimeType } from './constants'

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
  /**
   * 写真サムネイル機能③(2026-09-26ユーザー承認)。原本(file)と同じ元画像から
   * クライアント側で追加生成した表示用の軽量サムネイル。省略/nullの場合は
   * thumbnail_storage_pathがNULLのまま原本保存のみ成功として扱う
   * (最重要: 原本保存とサムネイル保存を同じ成功条件にしない)。
   */
  thumbnailFile?: Blob | null
}

export interface CustomerPhotoRecord {
  id:          string
  storagePath: string
  /**
   * 写真サムネイル機能③。既存のCustomerPhotoRecord生成箇所(テストのフェイク含む)を
   * 壊さないよう任意項目にする。未設定/null=サムネイル未生成(原本へフォールバック)。
   */
  thumbnailStoragePath?: string | null
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
  /**
   * 写真サムネイル機能③(2026-09-26ユーザー承認)。サムネイル用Storageアップロード。
   * 任意実装(未実装のRepoでもcommitCustomerPhotoは動作し、単にサムネイルを
   * 生成しない)。原本のuploadPhotoと異なり、このメソッドの失敗はcommitCustomerPhoto
   * 全体を失敗させない(最重要: 原本保存とサムネイル保存を同じ成功条件にしない)。
   */
  uploadThumbnail?(storagePath: string, file: Blob, opts: { upsert: boolean }): Promise<UploadPhotoResult>
  /**
   * 写真サムネイル機能③。原本insert後にthumbnail_storage_pathのみを更新する。
   * 任意実装。失敗してもcommitCustomerPhoto全体は成功のまま返す(ログのみ)。
   */
  setThumbnailPath?(photoId: string, thumbnailStoragePath: string): Promise<{ ok: boolean; error?: string }>
}

export type CommitCustomerPhotoResult =
  | { ok: true;  idempotent: boolean; photo: CustomerPhotoRecord }
  | { ok: false; reason: string }

// ─── storage_path の決定的生成(clientRequestIdによる冪等性の核) ────────────
//
// PHOTO_KARTE_API_DESIGN_1.md 10節: photo_id(DB生成)ではなくclientRequestIdを
// ファイル名に使う。アップロード時点ではDB行がまだ存在しないため。
// extensionは実際のファイル形式(webp/jpg)に合わせる(WebP/JPEGフォールバック対応)。
export function buildPhotoStoragePath(
  storeId:         string,
  customerId:      string,
  clientRequestId: string,
  extension:       string,
): string {
  return `${storeId}/${customerId}/${clientRequestId}.${extension}`
}

/**
 * 写真サムネイル機能③(2026-09-26ユーザー承認)。原本と同じclientRequestIdを起点に
 * 決定的なサムネイルパスを生成する(1対1対応、`_thumb`サフィックスのみ既存の
 * buildPhotoStoragePathと異なる)。原本のパス生成規則自体は変更しない。
 */
export function buildThumbnailStoragePath(
  storeId:         string,
  customerId:      string,
  clientRequestId: string,
  extension:       string,
): string {
  return `${storeId}/${customerId}/${clientRequestId}_thumb.${extension}`
}

/**
 * payload.file.type(サーバーが検証済みの実際のMIME)から保存用拡張子を導出する。
 * route.tsがALLOWED_PHOTO_MIME_TYPESで事前検証しているため、未知の値になることは
 * 通常ないが、型安全のためのフォールバックとしてwebpを既定にする。
 */
function extensionForFile(file: Blob): string {
  return PHOTO_MIME_EXTENSIONS[file.type as AllowedPhotoMimeType] ?? 'webp'
}

// ─── オーケストレーション本体 ─────────────────────────────────────────────────

export async function commitCustomerPhoto(
  repo:            CommitCustomerPhotoRepo,
  payload:         CommitCustomerPhotoPayload,
  clientRequestId: string,
): Promise<CommitCustomerPhotoResult> {
  const storagePath = buildPhotoStoragePath(
    payload.storeId, payload.customerId, clientRequestId, extensionForFile(payload.file)
  )

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

  // ── サムネイル保存(写真サムネイル機能③・2026-09-26ユーザー承認、非致命的) ──
  // ここまでのロジックは一切変更していない(原本のみ)。原本のINSERTが確定した
  // 新規写真(idempotent:falseになる経路)に限り、ベストエフォートでサムネイルを
  // 追加保存する。冪等応答(既存行の早期return・レース時のwinner合流)の各分岐では
  // 実行しない(=同一clientRequestIdの再試行でサムネイルを重複生成しない設計。
  // 既存の冪等性の仕組み自体は変更しない)。
  //
  // 最重要: 原本保存(上記まで)とサムネイル保存を同じ成功条件にしない。
  // 失敗しても commitCustomerPhoto 全体は ok:true のまま返し、
  // thumbnail_storage_path は NULL のまま(=signedUrl.ts側で原本へフォールバック)。
  // 失敗時に原本Storageを削除する等のrollbackは行わない。
  const photo: CustomerPhotoRecord = inserted.record
  if (payload.thumbnailFile && repo.uploadThumbnail && repo.setThumbnailPath) {
    try {
      const thumbnailStoragePath = buildThumbnailStoragePath(
        payload.storeId, payload.customerId, clientRequestId, extensionForFile(payload.thumbnailFile)
      )
      // upsert:trueで単純化する(原本のような孤児救済の3段階は不要。このアップロード自体が
      // 「ベストエフォート・失敗してもNULLのまま許容」という前提のため)。
      const thumbUpload = await repo.uploadThumbnail(thumbnailStoragePath, payload.thumbnailFile, { upsert: true })
      if (!thumbUpload.ok) {
        console.error(`[PHOTO_KARTE][thumbnail] storage upload failed (non-fatal, photo=${photo.id}):`, thumbUpload.error)
      } else {
        const setResult = await repo.setThumbnailPath(photo.id, thumbnailStoragePath)
        if (!setResult.ok) {
          console.error(`[PHOTO_KARTE][thumbnail] failed to persist thumbnail_storage_path (non-fatal, photo=${photo.id}):`, setResult.error)
        } else {
          photo.thumbnailStoragePath = thumbnailStoragePath
        }
      }
    } catch (e) {
      console.error(`[PHOTO_KARTE][thumbnail] unexpected error during thumbnail persistence (non-fatal, photo=${photo.id}):`, e)
    }
  }

  return { ok: true, idempotent: false, photo }
}
