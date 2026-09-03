/**
 * signedUrl.ts — 写真カルテのsigned URL発行(サーバー経由限定)。
 *
 * 設計: docs/PHOTO_KARTE_API_DESIGN_1.md 4節。
 * ブラウザから supabase.storage.from(PHOTO_BUCKET).createSignedUrl() を直接
 * 呼び出すコードは書かない(voice-notesとは意図的に異なる方式)。単一取得API・
 * バッチ取得APIはいずれもこのモジュールを経由する薄いラッパーとする。
 */
import { getPhotoServiceClient } from './photoDb'
import {
  PHOTO_BUCKET,
  SIGNED_URL_EXPIRY_DETAIL_SEC,
  SIGNED_URL_EXPIRY_THUMBNAIL_SEC,
  type SignedUrlPurpose,
} from './constants'

export interface SignedUrlEntry {
  url:       string
  expiresAt: string
}

function expirySecondsFor(purpose: SignedUrlPurpose): number {
  return purpose === 'thumbnail' ? SIGNED_URL_EXPIRY_THUMBNAIL_SEC : SIGNED_URL_EXPIRY_DETAIL_SEC
}

/**
 * 所有権確認済みの { id, storagePath } の配列に対し、まとめてsigned URLを発行する。
 * Storage側の createSignedUrls (バッチAPI) を使い、写真枚数分の逐次リクエストを避ける。
 */
export async function issueSignedUrlsForPhotos(
  photos:  Array<{ id: string; storagePath: string }>,
  purpose: SignedUrlPurpose,
): Promise<Record<string, SignedUrlEntry>> {
  if (photos.length === 0) return {}

  const expiresInSec = expirySecondsFor(purpose)
  const supabase = getPhotoServiceClient()

  const { data, error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrls(photos.map(p => p.storagePath), expiresInSec)

  if (error || !data) {
    throw new Error(`signed_url_failed:${error?.message ?? 'unknown error'}`)
  }

  const expiresAt = new Date(Date.now() + expiresInSec * 1000).toISOString()
  const pathToUrl = new Map(data.map(d => [d.path, d.signedUrl] as const))

  const result: Record<string, SignedUrlEntry> = {}
  for (const photo of photos) {
    const url = pathToUrl.get(photo.storagePath)
    if (url) {
      result[photo.id] = { url, expiresAt }
    }
  }
  return result
}
