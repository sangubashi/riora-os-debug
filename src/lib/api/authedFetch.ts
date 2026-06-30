/**
 * authedFetch.ts — クライアントサイド認証付き fetch ラッパー
 *
 * useAuthStore の session.access_token を Authorization ヘッダーに付与する。
 * セッション未取得の場合は通常の fetch にフォールバック（DEMO_MODE 対応）。
 */
import { useAuthStore } from '@/store/useAuthStore'

export async function authedFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const session = useAuthStore.getState().session
  const token   = session?.access_token

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  return fetch(url, { ...options, headers })
}
