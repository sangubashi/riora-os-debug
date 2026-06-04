/**
 * update-customer-stats.mjs
 * customers の visit_count / total_spent / last_visit_date を
 * 顧客タイプ別のリアルな数値に直接 UPDATE する
 */
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL        = 'REDACTED_URL'
const SUPABASE_SERVICE_KEY = 'REDACTED'

// service role クライアント（auth.admin で試みる）
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const STAFF_UUID = 'ae68433d-69ce-4dc3-a38e-cc2501895fee'

// ── 1. 顧客一覧取得 ──────────────────────────────────────────────
const { data: customers, error: fetchErr } = await admin
  .from('customers')
  .select('id, name, customer_type')
  .eq('assigned_staff_id', STAFF_UUID)

if (fetchErr) {
  console.error('❌ customers 取得失敗:', fetchErr.message)
  console.log('\n代わりに Supabase SQL Editor で以下を実行してください ↓')
  printSQL()
  process.exit(1)
}
if (!customers?.length) {
  console.warn('⚠ customers 0件 (assigned_staff_id フィルタが効いていない可能性)')
  printSQL()
  process.exit(0)
}
console.log(`✅ customers ${customers.length} 件取得`)

// ── 2. 決定論的ハッシュで数値を生成 ─────────────────────────────
function hash(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function statsFor(id, type) {
  const hvc = hash(id + 'vc')
  const hts = hash(id + 'ts')
  const hlv = hash(id + 'lv')

  switch (type) {
    case 'VIP型':
      return {
        visit_count:     10 + (hvc % 11),                         // 10〜20回
        total_spent:     200000 + (hts % 400001),                 // ¥20万〜¥60万
        days_ago:        3  + (hlv % 28),                         // 3〜30日前
      }
    case '効果重視型':
      return {
        visit_count:     5  + (hvc % 8),                          // 5〜12回
        total_spent:     60000  + (hts % 140001),                 // ¥6万〜¥20万
        days_ago:        14 + (hlv % 60),                         // 2週〜2ヶ月前
      }
    case '感情重視型':
      return {
        visit_count:     4  + (hvc % 7),                          // 4〜10回
        total_spent:     40000  + (hts % 110001),                 // ¥4万〜¥15万
        days_ago:        20 + (hlv % 50),                         // 3週〜2.5ヶ月前
      }
    case '信頼構築型':
      return {
        visit_count:     3  + (hvc % 6),                          // 3〜8回
        total_spent:     30000  + (hts % 70001),                  // ¥3万〜¥10万
        days_ago:        30 + (hlv % 90),                         // 1〜4ヶ月前
      }
    case '慎重・不安型':
      return {
        visit_count:     1  + (hvc % 4),                          // 1〜4回
        total_spent:     10000  + (hts % 30001),                  // ¥1万〜¥4万
        days_ago:        60 + (hlv % 120),                        // 2〜6ヶ月前
      }
    default:
      return {
        visit_count:     2  + (hvc % 5),
        total_spent:     20000  + (hts % 60001),
        days_ago:        40 + (hlv % 80),
      }
  }
}

function toDate(daysAgo) {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString().split('T')[0]
}

// ── 3. 1件ずつ UPDATE ───────────────────────────────────────────
let ok = 0; let ng = 0
for (const c of customers) {
  const { visit_count, total_spent, days_ago } = statsFor(c.id, c.customer_type)
  const last_visit_date = toDate(days_ago)

  const { error } = await admin
    .from('customers')
    .update({ visit_count, total_spent, last_visit_date })
    .eq('id', c.id)

  if (error) {
    console.warn(`  ❌ ${c.name}: ${error.message}`)
    ng++
  } else {
    console.log(`  ✅ ${c.name.padEnd(10)} ${c.customer_type.padEnd(8)} ${visit_count}回 ¥${total_spent.toLocaleString('ja-JP')}`)
    ok++
  }
}

console.log(`\n✅ 更新成功: ${ok}件  ❌ 失敗: ${ng}件`)
if (ng > 0) {
  console.log('\n失敗した行は Supabase SQL Editor で以下を実行してください ↓')
  printSQL()
}

// ── フォールバック SQL ───────────────────────────────────────────
function printSQL() {
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
UPDATE public.customers
SET
  visit_count = CASE customer_type
    WHEN 'VIP型'       THEN 10 + (abs(hashtext(id::text || 'vc')) % 11)
    WHEN '効果重視型'   THEN  5 + (abs(hashtext(id::text || 'vc')) %  8)
    WHEN '感情重視型'   THEN  4 + (abs(hashtext(id::text || 'vc')) %  7)
    WHEN '信頼構築型'   THEN  3 + (abs(hashtext(id::text || 'vc')) %  6)
    WHEN '慎重・不安型' THEN  1 + (abs(hashtext(id::text || 'vc')) %  4)
    ELSE                      2 + (abs(hashtext(id::text || 'vc')) %  5)
  END,
  total_spent = CASE customer_type
    WHEN 'VIP型'       THEN 200000 + (abs(hashtext(id::text || 'ts')) % 400001)
    WHEN '効果重視型'   THEN  60000 + (abs(hashtext(id::text || 'ts')) % 140001)
    WHEN '感情重視型'   THEN  40000 + (abs(hashtext(id::text || 'ts')) % 110001)
    WHEN '信頼構築型'   THEN  30000 + (abs(hashtext(id::text || 'ts')) % 70001)
    WHEN '慎重・不安型' THEN  10000 + (abs(hashtext(id::text || 'ts')) % 30001)
    ELSE                      25000 + (abs(hashtext(id::text || 'ts')) % 50001)
  END,
  last_visit_date = CURRENT_DATE - (
    CASE customer_type
      WHEN 'VIP型'       THEN  3 + (abs(hashtext(id::text || 'lv')) %  28)
      WHEN '効果重視型'   THEN 14 + (abs(hashtext(id::text || 'lv')) %  60)
      WHEN '感情重視型'   THEN 20 + (abs(hashtext(id::text || 'lv')) %  50)
      WHEN '信頼構築型'   THEN 30 + (abs(hashtext(id::text || 'lv')) %  90)
      WHEN '慎重・不安型' THEN 60 + (abs(hashtext(id::text || 'lv')) % 120)
      ELSE                    40 + (abs(hashtext(id::text || 'lv')) %  80)
    END
  );

-- 確認
SELECT name, customer_type, visit_count, total_spent, last_visit_date
FROM public.customers
ORDER BY total_spent DESC
LIMIT 10;
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`)
}
