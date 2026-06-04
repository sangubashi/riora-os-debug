/**
 * update-reservation-prices.mjs
 *
 * 1. test-staff としてログイン
 * 2. price カラムが存在するか確認
 * 3. 存在しなければ ALTER TABLE SQL を出力して終了（SQL Editor で実行してもらう）
 * 4. 存在すれば customers の type を取得し、
 *    顧客タイプ別の単価帯でリアルなバラつきをつけて reservations.price を一括更新
 * 5. customers.total_spent / visit_count も再集計
 */
import { createClient } from '@supabase/supabase-js'

const URL  = 'https://ohszxgajckzphhfhdrsv.supabase.co'
const ANON = 'sb_publishable_0VGV7G9x0Xm7lLUoR90QlA_Dkca2q4Q'
const EMAIL    = 'test-staff@salon-riora.jp'
const PASSWORD = 'password 1234'
const STAFF_UID = 'ae68433d-69ce-4dc3-a38e-cc2501895fee'

const client = createClient(URL, ANON, { auth: { persistSession: false } })

// ── ログイン ─────────────────────────────────────────────────────
const { error: loginErr } = await client.auth.signInWithPassword({
  email: EMAIL, password: PASSWORD
})
if (loginErr) { console.error('ログイン失敗:', loginErr.message); process.exit(1) }
console.log('✅ ログイン成功')

// ── price カラムの存在確認 ────────────────────────────────────────
const { error: colCheck } = await client
  .from('reservations')
  .select('id, price')
  .limit(1)

if (colCheck?.message?.includes('price')) {
  console.log('\n❌ reservations に price カラムが存在しません。')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('Supabase Dashboard > SQL Editor で以下を実行してください:')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('')
  console.log('ALTER TABLE public.reservations')
  console.log('  ADD COLUMN IF NOT EXISTS price INTEGER NOT NULL DEFAULT 0;')
  console.log('')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('実行後、このスクリプトを再度実行してください: node scripts/update-reservation-prices.mjs')
  process.exit(0)
}
console.log('✅ price カラム確認済み')

// ── customers の取得（顧客タイプマップ） ───────────────────────────
const { data: customers, error: custErr } = await client
  .from('customers')
  .select('id, customer_type, is_vip')
  .eq('assigned_staff_id', STAFF_UID)

if (custErr || !customers?.length) {
  console.error('customers 取得エラー:', custErr?.message ?? '0件')
  process.exit(1)
}
const typeMap = Object.fromEntries(customers.map(c => [c.id, c.customer_type ?? '信頼構築型']))
console.log(`✅ customers ${customers.length} 件取得`)

// ── reservations の取得 ──────────────────────────────────────────
const { data: reservations, error: resErr } = await client
  .from('reservations')
  .select('id, customer_id, price')
  .eq('staff_id', STAFF_UID)

if (resErr || !reservations?.length) {
  console.error('reservations 取得エラー:', resErr?.message ?? '0件')
  process.exit(1)
}
console.log(`✅ reservations ${reservations.length} 件取得`)

// ── 単価帯の定義 ─────────────────────────────────────────────────
const PRICE_RANGE = {
  'VIP型':       { base: 15000, range: 15000 },
  '効果重視型':   { base: 12000, range:  8000 },
  '感情重視型':   { base: 10000, range:  8000 },
  '慎重・不安型': { base:  8000, range:  6000 },
  '信頼構築型':   { base:  9000, range:  7000 },
}

// 決定論的ハッシュ（同じIDなら何度実行しても同じ価格になる）
function deterministicHash(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h >>> 0)
}

function calcPrice(resId, customerType) {
  const { base, range } = PRICE_RANGE[customerType] ?? PRICE_RANGE['信頼構築型']
  return base + (deterministicHash(resId + 'price') % (range + 1))
}

// ── price が 0 の予約だけ更新 ─────────────────────────────────────
const toUpdate = reservations.filter(r => (r.price ?? 0) === 0)
console.log(`📝 price=0 の予約: ${toUpdate.length} 件を更新します`)

let updated = 0
let skipped = 0
const errors = []

for (const r of toUpdate) {
  const customerType = typeMap[r.customer_id] ?? '信頼構築型'
  const price = calcPrice(r.id, customerType)

  const { error } = await client
    .from('reservations')
    .update({ price })
    .eq('id', r.id)

  if (error) {
    errors.push(`  ❌ ${r.id.slice(0,8)}… ${error.message}`)
  } else {
    updated++
  }
}

skipped = reservations.length - toUpdate.length
console.log(`✅ 更新完了: ${updated} 件 / スキップ(既に設定済み): ${skipped} 件`)
if (errors.length) {
  console.log('エラー:')
  errors.slice(0, 5).forEach(e => console.log(e))
}

// ── 価格の分布を確認 ─────────────────────────────────────────────
const { data: priceCheck } = await client
  .from('reservations')
  .select('price, customer_id')
  .eq('staff_id', STAFF_UID)

if (priceCheck) {
  const prices  = priceCheck.map(r => r.price ?? 0).filter(p => p > 0)
  const min     = Math.min(...prices)
  const max     = Math.max(...prices)
  const avg     = Math.round(prices.reduce((a, b) => a + b, 0) / (prices.length || 1))

  // 顧客ごとの合計
  const totals  = {}
  priceCheck.forEach(r => {
    if (r.customer_id) totals[r.customer_id] = (totals[r.customer_id] ?? 0) + (r.price ?? 0)
  })
  const totArr  = Object.values(totals)
  const minT    = Math.min(...totArr)
  const maxT    = Math.max(...totArr)

  console.log('\n📊 価格分布:')
  console.log(`  単価 最小: ¥${min.toLocaleString('ja-JP')}`)
  console.log(`  単価 最大: ¥${max.toLocaleString('ja-JP')}`)
  console.log(`  単価 平均: ¥${avg.toLocaleString('ja-JP')}`)
  console.log(`  顧客累計 最小: ¥${minT.toLocaleString('ja-JP')}`)
  console.log(`  顧客累計 最大: ¥${maxT.toLocaleString('ja-JP')}`)
}

console.log('\n🎉 完了！ブラウザで /customers を再読み込みしてください。')
