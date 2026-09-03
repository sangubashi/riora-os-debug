/**
 * constants.ts — 写真カルテAPI共通定数
 *
 * 設計根拠: docs/PHOTO_KARTE_DB_DESIGN_1.md 8-1節・9節、
 *   docs/PHOTO_KARTE_API_DESIGN_1.md 2節・4節
 */

/** Supabase Storage bucket名。bucket自体の作成はこのAPI実装のスコープ外(Dashboard操作)。 */
export const PHOTO_BUCKET = 'customer-photos'

/**
 * アップロード許可MIME。WebPを優先するが、iOS Safari等canvas.toBlob('image/webp')が
 * 非対応の環境(黙ってimage/png等へフォールバックする)向けに、クライアント側で
 * image/jpegへ自動フォールバックすることを許容する(実機テストで判明、
 * docs/PHOTO_KARTE_UX_WIREFRAME_1.md関連の実装前レビュー参照)。
 * 拡張子はPHOTO_MIME_EXTENSIONSで対応付ける。
 */
export const ALLOWED_PHOTO_MIME_TYPES = ['image/webp', 'image/jpeg'] as const
export type AllowedPhotoMimeType = typeof ALLOWED_PHOTO_MIME_TYPES[number]

/** MIME種別ごとのStorage保存用拡張子。 */
export const PHOTO_MIME_EXTENSIONS: Record<AllowedPhotoMimeType, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
}

/** アップロード上限バイト数(5MB案、PHOTO_KARTE_DB_DESIGN_1.md 8-1節)。 */
export const MAX_PHOTO_UPLOAD_BYTES = 5 * 1024 * 1024

export const PHOTO_TYPES = ['before', 'after', 'progress'] as const
export type PhotoType = typeof PHOTO_TYPES[number]

/** バッチsigned URL取得の一度のリクエストで許容する最大件数(PHOTO_KARTE_API_DESIGN_1.md 4節)。 */
export const BATCH_SIGNED_URL_MAX_IDS = 50

/** signed URL有効期限(秒)。一覧・比較用は短め、詳細表示用はvoice-notesと同水準。 */
export const SIGNED_URL_EXPIRY_THUMBNAIL_SEC = 10 * 60
export const SIGNED_URL_EXPIRY_DETAIL_SEC = 60 * 60

export type SignedUrlPurpose = 'thumbnail' | 'detail'

/** 一覧取得のデフォルト/最大件数。 */
export const PHOTO_LIST_DEFAULT_LIMIT = 60
export const PHOTO_LIST_MAX_LIMIT = 200

/**
 * 一覧取得の並び順(R2追補、docs/PHOTO_KARTE_API_DESIGN_1.md「API設計追補」節)。
 * 省略時は 'desc'(既存の taken_at DESC 固定動作を維持、後方互換)。
 */
export const PHOTO_LIST_ORDERS = ['asc', 'desc'] as const
export type PhotoListOrder = typeof PHOTO_LIST_ORDERS[number]
