/**
 * フロントエンド完全同期テスト
 * QuickServiceLog.saveLog() が行う Supabase 操作を完全再現
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const url     = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const sb      = createClient(url, anonKey)

// ── mock データ（Zustand / CustomerSheetContext 相当）──────────────
const MOCK_STAFF_ID   = 'kameyama'          // useStaffStore.currentStaffId
const MOCK_CUSTOMER   = {
  id:         'cust-k-001',                  // 非UUID → reservation=null になる
  hashId:     undefined as string | undefined,
}

// ── UUID チェック（QuickServiceLog と同じ実装）──────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (s: string | null | undefined): s is string => !!s && UUID_RE.test(s)

// ── QuickServiceLog.saveLog() の完全再現 ───────────────────────────
async function saveLog(actionKey: string, staffId: string | null) {
  // ① 未ログインガード
  if (!staffId) {
    return { ok: false, reason: 'no_staff_id' }
  }

  // ② reservation 組み立て（CustomerBottomSheet と同じロジック）
  const reservation = isUuid(MOCK_CUSTOMER.id)
    ? { id: MOCK_CUSTOMER.id, customer_id: null, customer_hash_id: MOCK_CUSTOMER.hashId ?? null }
    : null

  // ③ payload 組み立て（QuickServiceLog と同じ）
  const payload: Record<string, unknown> = {
    reservation_id:    reservation && isUuid(reservation.id) ? reservation.id : null,
    customer_id:       reservation && isUuid(reservation.customer_id ?? '') ? reservation.customer_id : null,
    staff_id:          null,
    service_completed: false,
    [actionKey]:       true,
  }

  console.log('\n  payload:', JSON.stringify(payload))

  // ④ INSERT
  const { data: inserted, error } = (await sb
    .from('staff_logs')
    .insert(payload)
    .select('id, created_at')
    .single()) as { data: { id: string; created_at: string } | null; error: any }

  if (error || !inserted) return { ok: false, reason: error?.code, message: error?.message }

  // ⑤ SELECT で確認
  const { data: fetched, error: selErr } = (await sb
    .from('staff_logs')
    .select('*')
    .eq('id', inserted.id)
    .single()) as { data: Record<string, any> | null; error: any }

  if (selErr || !fetched) return { ok: false, reason: 'select_failed', message: selErr?.message }

  // ⑥ クリーンアップ
  await sb.from('staff_logs').delete().eq('id', inserted.id)

  return { ok: true, inserted, fetched }
}

// ── テスト実行 ─────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════')
  console.log('  フロントエンド ↔ Supabase 完全同期テスト')
  console.log('═══════════════════════════════════════════════')

  const ACTIONS = [
    'ai_adopted', 'next_reserved', 'option_sold', 'retail_sold', 'churn_followed'
  ]

  const results: { action: string; ok: boolean; detail: string }[] = []

  for (const action of ACTIONS) {
    console.log(`\n▶ テスト: ${action}`)
    const result = await saveLog(action, MOCK_STAFF_ID)

    if (!result.ok) {
      results.push({ action, ok: false, detail: `${result.reason}: ${(result as any).message ?? ''}` })
      console.log(`  ❌ FAILED: ${result.reason}`)
      continue
    }

    // 値チェック
    const f = result.fetched!
    const valueOk = f[action] === true && f.service_completed === false
    results.push({
      action,
      ok: valueOk,
      detail: valueOk
        ? `id=${f.id.slice(0,8)}... | ${action}=true | service_completed=false | created_at OK`
        : `value mismatch: ${action}=${f[action]}`
    })
    console.log(`  ✅ OK  id: ${f.id}`)
    console.log(`      ${action}=${f[action]}, service_completed=${f.service_completed}`)
  }

  // ── サマリー ──────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════')
  console.log('  結果サマリー')
  console.log('═══════════════════════════════════════════════')
  results.forEach(r => {
    console.log(`  ${r.ok ? '✅' : '❌'}  ${r.action.padEnd(18)} ${r.detail}`)
  })
  const allOk = results.every(r => r.ok)
  console.log('─────────────────────────────────────────────')
  console.log(allOk
    ? '  ✅ 全アクション確認完了。フロントエンド↔Supabase 同期OK'
    : '  ❌ 一部失敗。上記エラーを確認してください')
  console.log('═══════════════════════════════════════════════')

  if (allOk) {
    console.log('\n次フェーズ: エステティシャン用入力UI ブラッシュアップへ')
    console.log('  - クイック入力改善')
    console.log('  - KPI表示')
    console.log('  - AI提案UI強化')
  }
}

main().catch(console.error)
