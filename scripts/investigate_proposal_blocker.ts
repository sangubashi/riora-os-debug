/**
 * investigate_proposal_blocker.ts — AI提案 no_customer_type ブロッカー調査(読み取り専用)
 *
 * 既存コードは一切変更しない。既存のgenerateCustomerProposal()(無変更)を実際に
 * 全顧客分呼び出し、成功/失敗の実態を集計する(DB書込は一切行わない・
 * POSTルートのbriefingRepo.insert()は呼ばない)。
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'
import { CustomerRepo } from '../src/repositories/supabase/CustomerRepo'
import { VisitRepo } from '../src/repositories/supabase/VisitRepo'
import { StaffRepo } from '../src/repositories/supabase/StaffRepo'
import { SubscriptionRepo } from '../src/repositories/supabase/SubscriptionRepo'
import { OutcomeRepo } from '../src/repositories/supabase/OutcomeRepo'
import { CandidateRepo } from '../src/repositories/supabase/CandidateRepo'
import { ParamsRepo } from '../src/repositories/supabase/ParamsRepo'
import { StatsRepo } from '../src/repositories/supabase/StatsRepo'
import { StoreRepo } from '../src/repositories/supabase/StoreRepo'
import { LineQueueRepo } from '../src/repositories/supabase/LineQueueRepo'
import { generateCustomerProposal } from '../src/lib/proposal/generateCustomerProposal'

const STORE_ID = '00000000-0000-0000-0000-000000000001'

async function main() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

  // ── 1〜3. brain_customers件数 / customer_type別件数 / NULL件数 ──────────────
  const { data: rawCustomers, count: totalIncludingDeleted } = await supabase
    .from('brain_customers')
    .select('id, name, customer_type, assigned_staff_id, deleted_at', { count: 'exact' })
    .eq('store_id', STORE_ID)

  const activeCustomers = (rawCustomers ?? []).filter((c) => c.deleted_at === null)
  const deletedCount = (rawCustomers ?? []).length - activeCustomers.length

  const typeBreakdown = new Map<string, number>()
  for (const c of activeCustomers) {
    const key = c.customer_type ?? '(NULL)'
    typeBreakdown.set(key, (typeBreakdown.get(key) ?? 0) + 1)
  }

  console.log('=== 1. brain_customers件数 ===')
  console.log(`store_id=${STORE_ID} の全行: ${totalIncludingDeleted}件(うちdeleted_at設定済み: ${deletedCount}件・有効: ${activeCustomers.length}件)`)
  console.log()

  console.log('=== 2. customer_type別件数(有効行のみ) ===')
  console.log('実スキーマのcustomer_type値はA_acne/B_pore/C_sensitive/D_aging/E_bridalの5種(brain_customers CHECK制約)。')
  console.log('「VIP/定期/新規/離脱危険」等は本スキーマには存在しない概念(別の分類軸・後述§考察参照)。')
  for (const [key, n] of Array.from(typeBreakdown.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key}: ${n}件`)
  }
  console.log()

  console.log('=== 3. NULL件数 ===')
  console.log(`customer_type IS NULL: ${typeBreakdown.get('(NULL)') ?? 0}件 / 有効顧客${activeCustomers.length}件中`)
  console.log()

  // ── 4〜6. AI提案対象顧客数 / 提案生成成功数 / 失敗理由ランキング ──────────────
  const repos = {
    customerRepo: new CustomerRepo(supabase),
    visitRepo: new VisitRepo(supabase),
    staffRepo: new StaffRepo(supabase),
    subscriptionRepo: new SubscriptionRepo(supabase),
    outcomeRepo: new OutcomeRepo(supabase),
    candidateRepo: new CandidateRepo(supabase),
    paramsRepo: new ParamsRepo(supabase),
    statsRepo: new StatsRepo(supabase),
    storeRepo: new StoreRepo(supabase),
    lineQueueRepo: new LineQueueRepo(supabase),
  }

  const staffList = await repos.staffRepo.listByStore(STORE_ID)
  const defaultStaffId = staffList[0]?.id
  console.log(`=== 4. AI提案対象顧客数 ===`)
  console.log(`有効顧客(deleted_at IS NULL): ${activeCustomers.length}件を全件、実際にgenerateCustomerProposal()へ通す`)
  console.log(`(スタッフは実在の${staffList[0]?.name ?? '不明'}を固定で使用・assigned_staff_idは全顧客NULLのため代表値)`)
  console.log()

  const outcomeCounts = new Map<string, number>()
  let successCount = 0
  const successSamples: string[] = []
  const noCandidateFiredSamples: string[] = []

  for (const c of activeCustomers) {
    if (!defaultStaffId) break
    const result = await generateCustomerProposal(
      { storeId: STORE_ID, customerId: c.id, staffId: defaultStaffId },
      repos
    )

    let outcome: string
    if (!result.ok) {
      outcome = result.reason
    } else if ('degraded' in result.proposal) {
      outcome = `degraded:${result.proposal.reason}`
    } else if (result.proposal.inStore.mandatory) {
      outcome = 'success'
      successCount += 1
      if (successSamples.length < 5) successSamples.push(`${c.name}(${c.id.slice(0, 8)}) → ${result.proposal.inStore.mandatory.candidateCode}`)
    } else {
      outcome = 'no_pattern_fired' // customerType/来店履歴は揃っているが、発火する候補が無かった
      if (noCandidateFiredSamples.length < 5) noCandidateFiredSamples.push(`${c.name}(${c.id.slice(0, 8)})`)
    }
    outcomeCounts.set(outcome, (outcomeCounts.get(outcome) ?? 0) + 1)
  }

  console.log('=== 5. 提案生成成功数 ===')
  console.log(`mandatory(本日の提案)が実際に発火した顧客数: ${successCount}件 / ${activeCustomers.length}件`)
  if (successSamples.length > 0) console.log('成功例:', successSamples.join(' / '))
  console.log()

  console.log('=== 6. 失敗理由ランキング(実際にgenerateCustomerProposal()を実行した結果) ===')
  for (const [reason, n] of Array.from(outcomeCounts.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason}: ${n}件`)
  }
  if (noCandidateFiredSamples.length > 0) console.log('no_pattern_fired例:', noCandidateFiredSamples.join(' / '))
  console.log()

  // ── 7. 顧客重複件数(Pass Dとの関連調査) ──────────────────────────────────
  const byName = new Map<string, { id: string; customerType: string | null }[]>()
  for (const c of activeCustomers) {
    const list = byName.get(c.name) ?? []
    list.push({ id: c.id, customerType: c.customer_type })
    byName.set(c.name, list)
  }
  const duplicates = Array.from(byName.entries()).filter(([, list]) => list.length > 1)

  console.log('=== 7. 顧客重複件数(Pass D関連調査) ===')
  console.log(`同姓同名で複数レコードが存在する人数: ${duplicates.length}名(関与レコード数: ${duplicates.reduce((s, [, l]) => s + l.length, 0)}件)`)
  for (const [name, list] of duplicates) {
    console.log(`  ${name}: ${list.length}件(customer_type: ${list.map((l) => l.customerType ?? 'NULL').join(', ')})`)
  }
  const passDNames = ['深堀 直美', '崔 京子', '井口 悠', '大熊 萌', '松下 直樹', '鈴木 雅子']
  const stillPresent = passDNames.filter((n) => duplicates.some(([name]) => name === n))
  const newlyFound = duplicates.filter(([name]) => !passDNames.includes(name)).map(([name]) => name)
  console.log(`Pass D記載の6組のうち現在も重複: ${stillPresent.length}組(${stillPresent.join(', ')})`)
  console.log(`Pass D未記載で新たに見つかった重複: ${newlyFound.length}組(${newlyFound.join(', ') || 'なし'})`)
}

main()
