import { readFileSync } from 'fs'
import { decodeCsvBuffer } from '../src/lib/import/csvEncoding'
import { runImportPipeline, type PipelineRepos } from '../src/lib/import/csvImportPipeline'
import type { Customer, Menu, OpsLog, Staff, Store, Visit } from '../src/types/riora.types'

const STORE_ID = 'store-1'
const CSV_PATH = 'test-data/csv-import/salonboard_test_real_fixed.csv'

function createFakeRepos(): PipelineRepos & { state: { customers: Customer[]; visits: Visit[]; opsLogs: OpsLog[] } } {
  const store: Store = {
    id: STORE_ID, name: 'テスト店舗', anonId: 'anon-1', anonSalt: 'fixed-test-salt',
    cluster: 'default', priceTier: 'standard', brainSubscription: true, learningMode: true,
  }
  // 異体字対応(外館→外舘へのalias登録)を含めたケースで再シミュレーション
  const staff: Staff[] = [
    { id: 'staff-suzuki', storeId: STORE_ID, name: '鈴木', style: 'evidence', isActive: true, nameAliases: [] },
    { id: 'staff-kameyama', storeId: STORE_ID, name: '亀山', style: 'evidence', isActive: true, nameAliases: [] },
    { id: 'staff-todate', storeId: STORE_ID, name: '外舘', style: 'evidence', isActive: true, nameAliases: ['外館'] },
  ]
  const menus: Menu[] = [
    { id: 'menu-1', storeId: STORE_ID, name: 'ヒト幹15000', price: 15000, role: 'entry', targetTypes: [] },
    { id: 'menu-2', storeId: STORE_ID, name: '毛穴洗浄+ヒト幹19000', price: 19000, role: 'pore', targetTypes: [] },
    { id: 'menu-3', storeId: STORE_ID, name: '水素+ヒト幹18000', price: 18000, role: 'sensitive', targetTypes: [] },
    { id: 'menu-4', storeId: STORE_ID, name: 'ハーブピーリング9900', price: 9900, role: 'peeling', targetTypes: [] },
    { id: 'menu-5', storeId: STORE_ID, name: 'EMS+小顔19000', price: 19000, role: 'lifting', targetTypes: [] },
    { id: 'menu-fallback', storeId: STORE_ID, name: 'CSV取込(メニュー名未マッチ)', price: 0, role: 'imported_other', targetTypes: [] },
  ]

  const state = { customers: [] as Customer[], visits: [] as Visit[], opsLogs: [] as OpsLog[] }
  let customerSeq = 0
  let visitSeq = 0

  const repos: PipelineRepos = {
    storeRepo: { findById: async (id) => (id === store.id ? store : null) },
    staffRepo: { listByStore: async () => staff, addNameAlias: async () => null },
    menuRepo: { listByStore: async () => menus },
    customerRepo: {
      findById: async (id) => state.customers.find(c => c.id === id) ?? null,
      listByStore: async () => [...state.customers],
      findByExternalKeyHash: async (_storeId, hash) => state.customers.find(c => c.externalKeyHash === hash) ?? null,
      create: async (input) => {
        customerSeq += 1
        const created: Customer = {
          id: `cust-${customerSeq}`, storeId: input.storeId, name: input.name, ageGroup: input.ageGroup,
          customerType: null, typeConfidence: 0, goalNote: null, weddingDate: null, acquisitionChannel: null,
          firstVisitDate: input.firstVisitDate, assignedStaffId: null, isSubscriber: false, subscribedAt: null,
          churnScore: 0, churnReason: null, consentAnonymizedLearning: false,
          prefecture: input.prefecture, city: input.city, externalKeyHash: input.externalKeyHash,
        }
        state.customers.push(created)
        return created
      },
      patchFromImport: async (id, input) => {
        const c = state.customers.find(x => x.id === id)
        if (!c) throw new Error('not found')
        c.ageGroup = c.ageGroup ?? input.ageGroup
        c.firstVisitDate = c.firstVisitDate ?? input.firstVisitDate
        c.prefecture = c.prefecture ?? input.prefecture
        c.city = c.city ?? input.city
        return c
      },
    },
    visitRepo: {
      recentByCustomer: async (customerId, n) => state.visits.filter(v => v.customerId === customerId).slice(0, n),
      countByCustomer: async (customerId) => state.visits.filter(v => v.customerId === customerId).length,
      findByCustomerAndDate: async (customerId, visitDate) =>
        state.visits.find(v => v.customerId === customerId && v.visitDate === visitDate) ?? null,
      create: async (visit) => {
        visitSeq += 1
        const created: Visit = { ...visit, id: `visit-${visitSeq}` }
        state.visits.push(created)
        return created
      },
      reconcile: async (id, input) => {
        const v = state.visits.find(x => x.id === id)
        if (!v) throw new Error('not found')
        Object.assign(v, input, { source: 'reconciled' })
        return v
      },
      sumSalesByStoreAndDate: async (storeId, visitDate) =>
        state.visits.filter(v => v.storeId === storeId && v.visitDate === visitDate)
          .reduce((sum, v) => sum + v.treatmentAmount + v.retailAmount, 0),
      listByStore: async (storeId) =>
        state.visits.filter(v => v.storeId === storeId).slice().sort((a, b) => a.visitDate.localeCompare(b.visitDate)),
    },
    opsLogRepo: {
      insert: async (log) => {
        const created: OpsLog = { ...log, id: `log-${state.opsLogs.length + 1}`, createdAt: new Date().toISOString() }
        state.opsLogs.push(created)
        return created
      },
      recentByStoreAndKind: async (storeId, kind, n) =>
        state.opsLogs.filter(l => l.storeId === storeId && l.kind === kind).slice(0, n),
    },
  }

  return { ...repos, state }
}

async function main() {
  const buf = readFileSync(CSV_PATH)
  const csvText = decodeCsvBuffer(buf)
  const repos = createFakeRepos()

  const result = await runImportPipeline({ storeId: STORE_ID, csvText, reviewDecisions: {} }, repos)
  if (!result.ok) { console.log('FAILED', result.code, result.message); return }

  console.log('=== rates(外館→外舘 alias登録済みでの再シミュレーション) ===')
  console.log(JSON.stringify(result.report.qualityReport.rates, null, 2))
  console.log()
  console.log('customers created:', repos.state.customers.length, '/ unique names:', new Set(repos.state.customers.map(c => c.name)).size)
  console.log('visits created:', repos.state.visits.length)
  console.log('duplicateCustomerNames:', JSON.stringify(result.report.qualityReport.duplicateCustomerNames))
  console.log('重複顧客作成率(分裂したレコード数/作成された顧客レコード総数):',
    Math.round((repos.state.customers.length - new Set(repos.state.customers.map(c => c.name)).size) / repos.state.customers.length * 100) + '%')
}

main()
