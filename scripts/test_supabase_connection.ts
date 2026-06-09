/**
 * test_supabase_connection.ts
 *
 * src/lib/supabase.ts の supabase クライアントを使い、
 * customers テーブルから 1件だけ取得して接続確認するテスト。
 *
 * 実行前に確認:
 *   1. .env.local に以下が設定されていること
 *      NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
 *      NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
 *   2. src/lib/supabase.ts の DEMO_MODE は変更しない（本テストは直接クライアントを使う）
 *
 * 実行方法:
 *   npx tsx scripts/test_supabase_connection.ts
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { createClient } from '@supabase/supabase-js'

// src/lib/supabase.ts と同じ設定でクライアントを生成
// （Next.js の @/ パスエイリアスが tsx で使えない場合の回避策）
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!url || !key) {
  console.error('[ERROR] 環境変数が未設定です')
  console.error('  NEXT_PUBLIC_SUPABASE_URL:', url ?? '未設定')
  console.error('  NEXT_PUBLIC_SUPABASE_ANON_KEY:', key ? '設定済み' : '未設定')
  process.exit(1)
}

const supabase = createClient(url, key)

async function main() {
  console.log('[INFO] Supabase 接続テスト開始')
  console.log('[INFO] URL:', url)
  console.log()

  const { data, error } = await supabase
    .from('customers')
    .select('id, name, customer_type, visit_count, churn_risk_score, is_vip')
    .limit(1)
    .single()

  if (error) {
    console.error('[FAIL] 取得エラー')
    console.error('  code   :', error.code)
    console.error('  message:', error.message)
    console.error('  hint   :', error.hint ?? 'なし')
    process.exit(1)
  }

  console.log('[OK] 取得成功')
  console.log('取得データ:', JSON.stringify(data, null, 2))
}

main()
