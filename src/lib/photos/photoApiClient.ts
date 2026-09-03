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
  // takenAtは省略しサーバー側のnow()相当に委ねる(既存API仕様どおり)。
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
