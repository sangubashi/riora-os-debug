/**
 * photoDb.ts — 写真カルテAPI(一覧・signed URL・削除)用のservice roleクライアント。
 *
 * commitCustomerPhotoRepo.supabase.ts とは別に、単純なCRUD系エンドポイントは
 * このモジュール経由でservice roleクライアントを取得する(src/lib/auth/canAccessCustomer.ts
 * の getServerClient() と同じ、各モジュールが自前でクライアントを持つ既存パターンに合わせる)。
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export function getPhotoServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase env not configured')
  return createClient(url, key, { auth: { persistSession: false } })
}
