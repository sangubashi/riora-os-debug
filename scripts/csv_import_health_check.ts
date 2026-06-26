/**
 * csv_import_health_check.ts — CSV Import健全性チェック(読み取り専用・DB書込なし)
 *
 * 本番再取込の前後で実行し、以下を確認する:
 *   - brain_customersの同姓同名重複(顧客名寄せの精度問題の検出。Pass D参照)
 *   - brain_visitsのmenu_id内訳(imported_otherへの集約状況。Pass C参照)
 *   - 直近のCSV取込ops_logs(unresolvedStaffCount等)
 *
 * 実行方法: npx tsx scripts/csv_import_health_check.ts [storeId]
 * (storeId省略時はDEMO_STORE_IDを使用)
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })

const DEFAULT_STORE_ID = '00000000-0000-0000-0000-000000000001'

async function main() {
  const storeId = process.argv[2] ?? DEFAULT_STORE_ID
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing env: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  const admin = createClient(url, key, { auth: { persistSession: false } })

  console.log(`=== CSV Import健全性チェック(store_id=${storeId}) ===\n`)

  // ── 1. 顧客名寄せ: 同姓同名の重複検出 ──────────────────────────────────────────
  const { data: customers, count: customerCount } = await admin
    .from('brain_customers')
    .select('id, name, first_visit_date', { count: 'exact' })
    .eq('store_id', storeId)
    .is('deleted_at', null)

  const byName = new Map<string, { id: string; first_visit_date: string | null }[]>()
  for (const c of customers ?? []) {
    const list = byName.get(c.name) ?? []
    list.push({ id: c.id, first_visit_date: c.first_visit_date })
    byName.set(c.name, list)
  }
  const dupes = Array.from(byName.entries()).filter(([, list]) => list.length > 1)

  console.log(`【1. 顧客名寄せ】brain_customers総数: ${customerCount}`)
  console.log(`同姓同名で複数レコードが存在する人数: ${dupes.length}名(${dupes.reduce((s, [, l]) => s + l.length, 0)}件のレコードが関与)`)
  for (const [name, list] of dupes) {
    console.log(`  - ${name}: ${list.length}件(初回来店日: ${list.map((c) => c.first_visit_date).join(', ')})`)
  }
  console.log()

  // ── 2. メニュー名寄せ: imported_other件数 ───────────────────────────────────────
  const { data: menus } = await admin.from('brain_menus').select('id, name, role').eq('store_id', storeId)
  const fallbackId = menus?.find((m) => m.role === 'imported_other')?.id
  const { data: visits, count: visitCount } = await admin
    .from('brain_visits')
    .select('menu_id', { count: 'exact' })
    .eq('store_id', storeId)
    .is('deleted_at', null)
  const fallbackCount = (visits ?? []).filter((v) => v.menu_id === fallbackId).length

  console.log(`【2. メニュー名寄せ】brain_visits総数: ${visitCount}`)
  console.log(`imported_other件数: ${fallbackCount} (${visitCount ? Math.round((fallbackCount / visitCount) * 100) : 0}%)`)
  console.log()

  // ── 3. スタッフ名寄せ: 直近CSV取込ログ ───────────────────────────────────────────
  const { data: logs } = await admin
    .from('brain_ops_logs')
    .select('created_at, detail')
    .eq('store_id', storeId)
    .eq('kind', 'csv_import')
    .order('created_at', { ascending: false })
    .limit(5)

  console.log('【3. 直近のCSV取込ログ(最大5件)】')
  for (const log of logs ?? []) {
    console.log(`  - ${log.created_at}: ${JSON.stringify(log.detail)}`)
  }
  if (!logs?.length) console.log('  (取込履歴なし)')
}

main()
