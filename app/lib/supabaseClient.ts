import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!url || !key) {
  console.error(
    '[Supabase] 環境変数が未設定です。\n' +
    '.env.local に NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY を設定してください。'
  )
}

export const supabase = createClient(url ?? '', key ?? '', {
  auth: {
    persistSession:   true,
    autoRefreshToken: true,
  },
})
