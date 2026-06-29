/**
 * run-proposal-all.ts — 全顧客 AI 提案再生成 & brain_pattern_fire_log 保存 (Pass U-1)
 *
 * 実行:
 *   npx ts-node --project tsconfig.scripts.json --transpile-only scripts/run-proposal-all.ts
 *
 * 生成フィールド:
 *   advice              → proposal.explanation.staffLine1
 *   avoidNote           → proposal.explanation.staffAvoid
 *   menuSuggestion      → proposal.inStore.mandatory?.adjustedScript
 *   nextVisitSuggestion → proposal.inStore.candidateDate
 *   lineSuggestion      → proposal.dm?.scenarioId
 *
 * 保存先: brain_pattern_fire_log (BriefingRepo.insert)
 */

import * as dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

import { CustomerRepo }    from '../src/repositories/supabase/CustomerRepo'
import { VisitRepo }       from '../src/repositories/supabase/VisitRepo'
import { StaffRepo }       from '../src/repositories/supabase/StaffRepo'
import { SubscriptionRepo } from '../src/repositories/supabase/SubscriptionRepo'
import { OutcomeRepo }     from '../src/repositories/supabase/OutcomeRepo'
import { CandidateRepo }   from '../src/repositories/supabase/CandidateRepo'
import { ParamsRepo }      from '../src/repositories/supabase/ParamsRepo'
import { StatsRepo }       from '../src/repositories/supabase/StatsRepo'
import { StoreRepo }       from '../src/repositories/supabase/StoreRepo'
import { LineQueueRepo }   from '../src/repositories/supabase/LineQueueRepo'
import { BriefingRepo }    from '../src/repositories/supabase/BriefingRepo'
import { generateCustomerProposal } from '../src/lib/proposal/generateCustomerProposal'
import type { FinalProposalSet } from '../src/types/riora.types'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const STORE_ID = process.env.DEMO_STORE_ID ?? '00000000-0000-0000-0000-000000000001'
const DEFAULT_STAFF = '00000000-0000-0000-0000-000000000101' // 鈴木

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です')
  process.exit(1)
}

interface ProposalRow {
  customerName:       string
  customerType:       string | null
  outcome:            'success' | 'degraded' | 'failed'
  failReason?:        string
  advice:             string | null
  avoidNote:          string | null
  menuSuggestion:     string | null
  nextVisitSuggestion: string | null
  lineSuggestion:     string | null
}

async function main() {
  const supabase = createClient(SUPABASE_URL!, SERVICE_KEY!, { auth: { persistSession: false } })

  const repos = {
    customerRepo:    new CustomerRepo(supabase)    as never,
    visitRepo:       new VisitRepo(supabase)        as never,
    staffRepo:       new StaffRepo(supabase)        as never,
    subscriptionRepo: new SubscriptionRepo(supabase) as never,
    outcomeRepo:     new OutcomeRepo(supabase)      as never,
    candidateRepo:   new CandidateRepo(supabase)    as never,
    paramsRepo:      new ParamsRepo(supabase)        as never,
    statsRepo:       new StatsRepo(supabase)         as never,
    storeRepo:       new StoreRepo(supabase)         as never,
    lineQueueRepo:   new LineQueueRepo(supabase)     as never,
  }
  const briefingRepo = new BriefingRepo(supabase)

  // 全顧客取得
  const { data: rawCustomers, error: listErr } = await supabase
    .from('brain_customers')
    .select('id, name, customer_type, deleted_at')
    .eq('store_id', STORE_ID)

  if (listErr) {
    console.error('❌ brain_customers 取得エラー:', listErr.message)
    process.exit(1)
  }

  const customers = (rawCustomers ?? []).filter((c: { deleted_at: string | null }) => c.deleted_at === null)

  console.log(`\n${'═'.repeat(70)}`)
  console.log(` AI 提案再生成 (Pass U-1)  対象: ${customers.length} 名`)
  console.log(`${'═'.repeat(70)}`)

  const rows: ProposalRow[] = []

  for (const c of customers) {
    process.stdout.write(`  [${rows.length + 1}/${customers.length}] ${c.name}... `)

    try {
      const result = await generateCustomerProposal(
        { storeId: STORE_ID, customerId: c.id, staffId: DEFAULT_STAFF, legacyClient: supabase },
        repos,
      )

      if (!result.ok) {
        process.stdout.write(`失敗 (${result.reason})\n`)
        rows.push({ customerName: c.name, customerType: c.customer_type, outcome: 'failed', failReason: result.reason, advice: null, avoidNote: null, menuSuggestion: null, nextVisitSuggestion: null, lineSuggestion: null })
        continue
      }

      const isDegraded = 'degraded' in result.proposal
      const proposal: FinalProposalSet = isDegraded ? (result.proposal as { proposal: FinalProposalSet }).proposal : result.proposal as FinalProposalSet

      const advice             = proposal.explanation.staffLine1 || null
      const avoidNote          = proposal.explanation.staffAvoid || null
      const menuSuggestion     = proposal.inStore.mandatory?.adjustedScript ?? null
      const nextVisitSuggestion = proposal.inStore.candidateDate ?? null
      const lineSuggestion     = proposal.dm?.scenarioId ?? null

      // brain_pattern_fire_log に保存
      const decisionRecord = isDegraded
        ? { degraded: true, reason: (result.proposal as { reason: string }).reason, contextSnapshot: result.context }
        : {
            candidates: [],
            resolution: { winner: [proposal.inStore.mandatory?.candidateCode].filter((v): v is string => !!v), stage4TiebreakUsed: false },
            contextSnapshot: result.context,
            explainTexts: proposal.explanation,
          }
      const explanation = isDegraded
        ? `提案生成が縮退しました: ${(result.proposal as { reason: string }).reason}`
        : (advice ?? '提案なし')

      await briefingRepo.insert({
        storeId:       STORE_ID,
        customerId:    c.id,
        visitId:       null,
        decisionRecord: decisionRecord as Record<string, unknown>,
        explanation,
      })

      const tag = isDegraded ? '縮退' : '✅'
      process.stdout.write(`${tag}\n`)
      rows.push({ customerName: c.name, customerType: c.customer_type, outcome: isDegraded ? 'degraded' : 'success', advice, avoidNote, menuSuggestion, nextVisitSuggestion, lineSuggestion })
    } catch (e) {
      process.stdout.write(`例外: ${String(e).slice(0, 60)}\n`)
      rows.push({ customerName: c.name, customerType: c.customer_type, outcome: 'failed', failReason: String(e).slice(0, 120), advice: null, avoidNote: null, menuSuggestion: null, nextVisitSuggestion: null, lineSuggestion: null })
    }
  }

  // ── 集計 ──────────────────────────────────────────────────────────────
  const successRows  = rows.filter(r => r.outcome === 'success')
  const degradedRows = rows.filter(r => r.outcome === 'degraded')
  const failedRows   = rows.filter(r => r.outcome === 'failed')

  // CustomerType 別集計
  const byType: Record<string, { success: number; degraded: number; failed: number }> = {}
  for (const r of rows) {
    const key = r.customerType ?? '(NULL)'
    if (!byType[key]) byType[key] = { success: 0, degraded: 0, failed: 0 }
    byType[key][r.outcome === 'degraded' ? 'degraded' : r.outcome === 'success' ? 'success' : 'failed']++
  }

  console.log(`\n${'═'.repeat(70)}`)
  console.log('【生成結果集計】')
  console.log(`  生成成功 (full proposal)  : ${successRows.length} 名`)
  console.log(`  縮退成功 (degraded)        : ${degradedRows.length} 名`)
  console.log(`  生成失敗                   : ${failedRows.length} 名`)
  console.log(`  合計                       : ${rows.length} 名`)

  console.log('\n【CustomerType 別件数】')
  const typeOrder = ['A_acne', 'B_pore', 'C_sensitive', 'D_aging', 'E_bridal', '(NULL)']
  const allTypes  = typeOrder.filter(t => byType[t])
  const otherTypes = Object.keys(byType).filter(t => !typeOrder.includes(t))
  for (const t of [...allTypes, ...otherTypes]) {
    const { success: s, degraded: d, failed: f } = byType[t]
    console.log(`  ${t.padEnd(15)}: 成功 ${s} / 縮退 ${d} / 失敗 ${f}`)
  }

  if (failedRows.length > 0) {
    console.log('\n【失敗理由】')
    const byReason: Record<string, number> = {}
    for (const r of failedRows) {
      const key = r.failReason ?? 'unknown'
      byReason[key] = (byReason[key] ?? 0) + 1
    }
    Object.entries(byReason).sort(([, a], [, b]) => b - a).forEach(([reason, n]) => {
      console.log(`  ${reason}: ${n} 件`)
    })
  }

  // サンプル: 成功した提案の最初の 5 件
  if (successRows.length > 0) {
    console.log('\n【成功サンプル (最大5件)】')
    console.log(`  ${'顧客名'.padEnd(12)} ${'Type'.padEnd(15)} advice (先頭60文字)`)
    console.log(`  ${'─'.repeat(70)}`)
    for (const r of successRows.slice(0, 5)) {
      const name   = r.customerName.padEnd(12)
      const type   = (r.customerType ?? 'NULL').padEnd(15)
      const advice = (r.advice ?? '─').slice(0, 60)
      console.log(`  ${name} ${type} ${advice}`)
    }
  }

  console.log(`\n${'═'.repeat(70)}`)
  console.log(' ✅ Pass U-1 完了 — brain_pattern_fire_log 保存済み')
  console.log(`${'═'.repeat(70)}\n`)
}

main().catch(err => {
  console.error('❌ 実行エラー:', err)
  process.exit(1)
})
