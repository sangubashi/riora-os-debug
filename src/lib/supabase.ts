import { createClient } from '@supabase/supabase-js'

// デモモード: true = モックデータ使用（長押し導線検証用）
export const DEMO_MODE = true

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// ── anon key 形式チェック（起動時に診断） ────────────────────────────────────
// 正しい形式: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9... (JWT)
// 古い形式:   sb_publishable_... (非対応)
if (typeof window !== 'undefined' && key && !key.startsWith('eyJ')) {
  console.error(
    '[Supabase] ⚠️ ANON KEY の形式が正しくありません。\n' +
    'Supabase Dashboard → Settings → API → anon public キーをコピーしてください。\n' +
    '正しい形式: eyJhbGci... で始まる JWT 形式\n' +
    `現在の形式: ${key.slice(0, 20)}...`
  )
}

export const supabase = createClient(
  url ?? 'https://placeholder.supabase.co',
  key ?? 'placeholder_anon_key',
  {
    auth: {
      persistSession:    true,
      autoRefreshToken:  true,
      detectSessionInUrl: true,
      flowType:          'pkce',
    },
  }
)
