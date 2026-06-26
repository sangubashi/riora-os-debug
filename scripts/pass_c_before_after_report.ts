/**
 * pass_c_before_after_report.ts — Pass C(CSV取込メニュー名名寄せ改善) Before/After比較
 *
 * 実際に本番importで使われた実データCSV(test-data/csv-import/salonboard_test_real_fixed.csv)を、
 * 本番brain_menus(読み取り専用・service_role)に対してパース+解決だけ行う(DB書込は一切しない)。
 *
 * Before: 旧ロジック(menuNameを常に空文字に強制)を再現してresolveMenuIdを呼ぶ
 * After:  新ロジック(salonBoardDetailParser.aggregateCheckouts()の代表行選定 + 4段階解決)
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })

import { readFileSync } from 'fs'
import { decodeCsvBuffer } from '../src/lib/import/csvEncoding'
import { parseSalonBoardDetailCsv, aggregateCheckouts } from '../src/lib/import/salonBoardDetailParser'
import { buildMenuLookup, resolveMenuId, type MenuResolutionMethod } from '../src/lib/import/menuResolver'
import type { Menu } from '../src/types/riora.types'

const STORE_ID = '00000000-0000-0000-0000-000000000001'
const CSV_PATH = 'test-data/csv-import/salonboard_test_real_fixed.csv'

async function fetchMenus(): Promise<Menu[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing env: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  const admin = createClient(url, key, { auth: { persistSession: false } })

  const { data, error } = await admin
    .from('brain_menus')
    .select('id, store_id, name, price, role, target_types')
    .eq('store_id', STORE_ID)
    .is('deleted_at', null)
  if (error) throw new Error(`brain_menus取得失敗: ${error.message}`)

  return (data ?? []).map((row) => ({
    id: row.id, storeId: row.store_id, name: row.name, price: row.price,
    role: row.role, targetTypes: row.target_types,
  }))
}

type TallyKey = MenuResolutionMethod | 'unresolved'

function emptyTally(): Record<TallyKey, number> {
  return { exact_match: 0, normalized_match: 0, partial_match: 0, fallback_other: 0, unresolved: 0 }
}

async function main() {
  const menus = await fetchMenus()
  console.log('=== brain_menus(本番・store固定)===')
  console.log(menus.map((m) => `${m.role}: ${m.name}`).join('\n'))
  console.log()

  const buf = readFileSync(CSV_PATH)
  const csvText = decodeCsvBuffer(buf)
  const parsed = parseSalonBoardDetailCsv(csvText)
  const { aggregates } = aggregateCheckouts(parsed.rows)

  console.log(`総会計数(checkout数): ${aggregates.length}`)
  console.log()

  const lookup = buildMenuLookup(menus)

  // ── Before: 旧ロジック(menuNameを常に空文字に強制していた挙動を再現) ──────────────
  const beforeTally = emptyTally()
  for (const _agg of aggregates) {
    const res = resolveMenuId('', lookup) // 旧salonBoardDetailParser.tsの挙動(menuName: '')
    beforeTally[res.status === 'unresolved' ? 'unresolved' : res.method] += 1
  }

  // ── After: 新ロジック(代表行選定 + 4段階解決) ────────────────────────────────
  const afterTally = emptyTally()
  const afterDetail = new Map<string, { method: TallyKey; resolvedMenuName: string | null; count: number }>()
  for (const agg of aggregates) {
    const res = resolveMenuId(agg.menuName, lookup)
    const method: TallyKey = res.status === 'unresolved' ? 'unresolved' : res.method
    afterTally[method] += 1

    const key = agg.menuName === '' ? '(代表メニュー名なし・店販/割引のみ)' : agg.menuName
    const existing = afterDetail.get(key)
    if (existing) existing.count += 1
    else afterDetail.set(key, {
      method,
      resolvedMenuName: res.status === 'unresolved' ? null : res.menuName,
      count: 1,
    })
  }

  console.log('=== Before(旧ロジック: menuName常に空文字) ===')
  console.log(JSON.stringify(beforeTally, null, 2))
  console.log()
  console.log('=== After(新ロジック: 代表行選定 + exact/normalized/partial/fallback) ===')
  console.log(JSON.stringify(afterTally, null, 2))
  console.log()

  console.log('=== After: 生メニュー名ごとの解決内訳 ===')
  for (const [rawName, info] of Array.from(afterDetail.entries()).sort((a, b) => b[1].count - a[1].count)) {
    console.log(`${rawName} (${info.count}件) → ${info.method}${info.resolvedMenuName ? ` [${info.resolvedMenuName}]` : ''}`)
  }
  console.log()

  const beforeFallbackOrUnresolved = beforeTally.fallback_other + beforeTally.unresolved
  const afterFallbackOrUnresolved = afterTally.fallback_other + afterTally.unresolved
  console.log('=== サマリー ===')
  console.log(`Before: imported_other(fallback)+unresolved = ${beforeFallbackOrUnresolved} / ${aggregates.length}件`)
  console.log(`After:  imported_other(fallback)+unresolved = ${afterFallbackOrUnresolved} / ${aggregates.length}件`)
  console.log(`削減件数: ${beforeFallbackOrUnresolved - afterFallbackOrUnresolved}件`)
}

main()
