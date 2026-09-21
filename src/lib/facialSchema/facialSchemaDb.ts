/**
 * facialSchemaDb.ts — 顔シェーマAPI用のservice roleクライアント。
 *
 * src/lib/photos/photoDb.ts と同じ「各モジュールが自前でservice roleクライアントを
 * 持つ」既存パターンをそのまま踏襲する。
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export function getFacialSchemaServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase env not configured')
  return createClient(url, key, { auth: { persistSession: false } })
}
