'use client'
/**
 * photoApiClient.ts — 撮影画面(PhotoCaptureView)から既存PHOTO_KARTE APIを呼ぶための薄いクライアント
 *
 * 認証は authedFetch(src/lib/api/authedFetch.ts)にそのまま委譲する。既存APIの認証方式
 * (Authorization: Bearer + JWT)・認可(extractStaffFromRequest→canAccessCustomer)は
 * 一切変更しない。created_by/store_id/storage_pathはサーバー側で解決される値であり、
 * このクライアントからは送信しない(docs/PHOTO_KARTE_API_DESIGN_1.md 5-1節)。
 *
 * ghostSelection.ts の PhotoListFetcher / captureConfirmFlow.ts の UploadPhotoFn は
 * ここで生成するアダプタ経由で結合する(ロジック本体はHTTPを知らない)。
 */
import { authedFetch } from '@/lib/api/authedFetch'
import type { GhostCandidatePhoto, ListPhotosParams, PhotoListFetcher, PhotoType } from './ghostSelection'
import type { CapturedPhotoPayload, UploadPhotoFn } from './captureConfirmFlow'
import { PHOTO_MIME_EXTENSIONS, type AllowedPhotoMimeType } from './constants'

interface PhotoListApiRow {
  id:        string
  visitId:   string | null
  bodyPart:  string
  photoType: PhotoType
  storagePath: string
  takenAt:   string
}

interface PhotoListApiResponse {
  success: boolean
  photos?: PhotoListApiRow[]
  error?:  string
}

export async function listCustomerPhotos(
  customerId: string,
  params: Omit<ListPhotosParams, 'customerId'>
): Promise<GhostCandidatePhoto[]> {
  const sp = new URLSearchParams()
  sp.set('bodyPart', params.bodyPart)
  if (params.visitId)   sp.set('visitId', params.visitId)
  if (params.photoType) sp.set('photoType', params.photoType)
  if (params.order)     sp.set('order', params.order)
  sp.set('limit', String(params.limit ?? 5))

  const res = await authedFetch(`/api/customers/${customerId}/photos?${sp.toString()}`)
  if (!res.ok) return []

  const body = (await res.json()) as PhotoListApiResponse
  if (!body.success || !body.photos) return []

  return body.photos.map(p => ({
    id:          p.id,
    visitId:     p.visitId,
    bodyPart:    p.bodyPart,
    photoType:   p.photoType,
    storagePath: p.storagePath,
    takenAt:     p.takenAt,
  }))
}

/** ghostSelection.ts の PhotoListFetcher 実装。customerIdをクロージャで固定する。 */
export function createPhotoListFetcher(customerId: string): PhotoListFetcher {
  return {
    listPhotos: (params) => listCustomerPhotos(customerId, params),
  }
}

export interface UploadPhotoApiResult {
  photoId:     string
  storagePath: string
  idempotent:  boolean
}

export async function uploadCustomerPhoto(
  customerId: string,
  payload: CapturedPhotoPayload & { clientRequestId: string }
): Promise<UploadPhotoApiResult> {
  const form = new FormData()
  // ファイル名の拡張子は実際のBlob.typeに合わせる(サーバーはこの拡張子自体を
  // 信用せず、file.typeで独自に再検証する。ここではログ・デバッグ時の一貫性のため)。
  const extension = PHOTO_MIME_EXTENSIONS[payload.blob.type as AllowedPhotoMimeType] ?? 'webp'
  form.set('file', payload.blob, `${payload.clientRequestId}.${extension}`)
  form.set('bodyPart', payload.bodyPart)
  form.set('photoType', payload.photoType)
  form.set('clientRequestId', payload.clientRequestId)
  if (payload.visitId) form.set('visitId', payload.visitId)
  // takenAtは任意。省略時は既存どおりサーバー側のnow()相当に委ねる。カメラ撮影フローは
  // 常に省略するため挙動は変わらない。写真ライブラリ選択(Phase2)のみFile.lastModified
  // 由来の値をpayload.takenAtとして渡す場合がある(batchUpload.ts参照)。
  if (payload.takenAt) form.set('takenAt', payload.takenAt)
  // createdBy/storeId/storagePathはクライアントから一切送らない
  // (サーバー側でJWTから解決したstaffBrainId・固定STORE_ID・決定的パスのみを使う)。

  const res = await authedFetch(`/api/customers/${customerId}/photos`, {
    method: 'POST',
    body:   form,
  })

  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body?.success) {
    const reason = body?.reason ?? body?.error ?? `upload_failed:${res.status}`
    throw new Error(reason)
  }

  return { photoId: body.photoId, storagePath: body.storagePath, idempotent: !!body.idempotent }
}

/** captureConfirmFlow.ts の UploadPhotoFn 実装。customerIdをクロージャで固定する。 */
export function createUploadPhotoFn(customerId: string): UploadPhotoFn {
  return async (payload) => {
    await uploadCustomerPhoto(customerId, payload)
  }
}

export async function getPhotoSignedUrl(
  customerId: string,
  photoId: string,
  purpose: 'thumbnail' | 'detail' = 'thumbnail'
): Promise<string | null> {
  const res = await authedFetch(
    `/api/customers/${customerId}/photos/${photoId}/signed-url?purpose=${purpose}`
  )
  if (!res.ok) return null

  const body = await res.json().catch(() => null)
  if (!body?.success) return null
  return body.url as string
}

/** Photo Timeline(顧客ごとの写真時系列一覧)用の1件分の型。GhostCandidatePhotoより表示に必要な情報が多い。 */
export interface TimelinePhoto {
  id:           string
  visitId:      string | null
  visitDate:    string | null
  menuName:     string | null
  bodyPart:     string
  photoType:    PhotoType
  storagePath:  string
  takenAt:      string
}

interface TimelinePhotoApiRow {
  id:           string
  visitId:      string | null
  visitDate?:   string | null
  menuName?:    string | null
  bodyPart:     string
  photoType:    PhotoType
  storagePath:  string
  takenAt:      string
}

interface TimelineListApiResponse {
  success:    boolean
  photos?:    TimelinePhotoApiRow[]
  nextCursor?: string | null
  error?:     string
}

/**
 * Photo Timeline用の一覧取得。既存の GET /api/customers/[id]/photos をそのまま使う
 * (新規APIは作らない)。order省略=既存どおりtaken_at DESC(新しい順)。
 */
export async function listCustomerPhotosTimeline(
  customerId: string,
  limit = 60
): Promise<TimelinePhoto[]> {
  const sp = new URLSearchParams()
  sp.set('limit', String(limit))

  const res = await authedFetch(`/api/customers/${customerId}/photos?${sp.toString()}`)
  if (!res.ok) return []

  const body = (await res.json()) as TimelineListApiResponse
  if (!body.success || !body.photos) return []

  return body.photos.map(p => ({
    id:          p.id,
    visitId:     p.visitId,
    visitDate:   p.visitDate ?? null,
    menuName:    p.menuName ?? null,
    bodyPart:    p.bodyPart,
    photoType:   p.photoType,
    storagePath: p.storagePath,
    takenAt:     p.takenAt,
  }))
}

/**
 * サムネイル表示用のsigned URLをまとめて取得する(既存の POST .../photos/signed-urls を利用)。
 * 取得できなかったIDは結果に含めない(呼び出し側はurlの有無で表示を出し分ける)。
 */
export async function getBatchSignedUrls(
  customerId: string,
  photoIds:   string[],
  purpose:    'thumbnail' | 'detail' = 'thumbnail'
): Promise<Record<string, string>> {
  if (photoIds.length === 0) return {}

  const res = await authedFetch(`/api/customers/${customerId}/photos/signed-urls`, {
    method: 'POST',
    body:   JSON.stringify({ photoIds, purpose }),
  })
  if (!res.ok) return {}

  const body = await res.json().catch(() => null) as
    { success: boolean; urls?: Record<string, { url: string; expiresAt: string }> } | null
  if (!body?.success || !body.urls) return {}

  const result: Record<string, string> = {}
  for (const [id, entry] of Object.entries(body.urls)) result[id] = entry.url
  return result
}
