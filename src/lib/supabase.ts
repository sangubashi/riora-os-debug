import { createClient } from '@supabase/supabase-js'

// デモモード: false = 実データ使用
export const DEMO_MODE = false

// Voice Memo機能のみ実DB保存を有効化する（DEMO_MODE=trueのまま維持）
export const VOICE_NOTES_LIVE = true

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// ── anon key 形式チェック（起動時に診断） ────────────────────────────────────
// 対応形式: eyJhbGci... (JWT) または sb_publishable_... (Supabase 新形式)
if (typeof window !== 'undefined' && key && !key.startsWith('eyJ') && !key.startsWith('sb_')) {
  console.error(
    '[Supabase] ⚠️ ANON KEY の形式が正しくありません。\n' +
    'Supabase Dashboard → Settings → API → anon public キーをコピーしてください。\n' +
    '対応形式: eyJhbGci... (JWT) または sb_publishable_... (新形式)\n' +
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
