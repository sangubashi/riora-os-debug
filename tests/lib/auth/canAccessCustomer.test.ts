import { beforeEach, describe, expect, it, vi } from 'vitest'

// PHASE SECURITY-H1: canAccessCustomer() / filterAccessibleCustomerIds() が
// brain_customers.is_internal_user=true の顧客を、管理者以外に対して常に除外することを検証する。
// あわせて、Rule A'/B'/C(AUTH-1 V2)の既存挙動を壊していないことも確認する。
//
// 本番の内部ユーザー2件(外舘裕子・鈴木雅子)はいずれも来店履歴を持ち、その最新来店担当スタッフが
// 同一人物(「外舘」)であることを本番DB調査で確認済みのため、TC群にもこの実データ形状
// (internal顧客でもRule A'相当の一致条件が成立し得る)を再現し、それでも常にfalse/除外に
// なることを確認する(cust-int-1 = 外舘裕子相当、cust-int-2 = 鈴木雅子相当)。

const STORE_ID = '00000000-0000-0000-0000-000000000001'

type Row = Record<string, unknown>

let DB: {
  brain_customers: Row[]
  brain_visits: Row[]
  reservations: Row[]
  brain_staff: Row[]
}

function resetDb() {
  DB = { brain_customers: [], brain_visits: [], reservations: [], brain_staff: [] }
}
resetDb()

/** 実装が使うチェーン(eq/in/is/gte/lte/neq/order/limit/single/maybeSingle、および
 * 終端メソッド無しでのawait)だけをサポートする最小限のフルエントモック。 */
class QB {
  private rows: Row[]
  constructor(rows: Row[]) {
    this.rows = [...rows]
  }
  select() { return this }
  eq(col: string, val: unknown) { this.rows = this.rows.filter(r => r[col] === val); return this }
  in(col: string, vals: unknown[]) { this.rows = this.rows.filter(r => vals.includes(r[col])); return this }
  is(col: string, val: unknown) { this.rows = this.rows.filter(r => r[col] === val); return this }
  gte(col: string, val: string) { this.rows = this.rows.filter(r => (r[col] as string) >= val); return this }
  lte(col: string, val: string) { this.rows = this.rows.filter(r => (r[col] as string) <= val); return this }
  neq(col: string, val: unknown) { this.rows = this.rows.filter(r => r[col] !== val); return this }
  order(col: string, opts?: { ascending?: boolean }) {
    const asc = opts?.ascending !== false
    this.rows = [...this.rows].sort((a, b) => {
      const av = a[col] as string, bv = b[col] as string
      if (av < bv) return asc ? -1 : 1
      if (av > bv) return asc ? 1 : -1
      return 0
    })
    return this
  }
  limit(n: number) { this.rows = this.rows.slice(0, n); return this }
  single() {
    return Promise.resolve(
      this.rows.length === 1 ? { data: this.rows[0], error: null } : { data: null, error: { message: 'not found' } }
    )
  }
  maybeSingle() { return Promise.resolve({ data: this.rows[0] ?? null, error: null }) }
  then<T1, T2 = never>(
    onfulfilled?: ((value: { data: Row[]; error: null }) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null
  ) {
    return Promise.resolve({ data: this.rows, error: null }).then(onfulfilled, onrejected)
  }
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: keyof typeof DB) => new QB(DB[table] ?? []),
  }),
}))

describe('canAccessCustomer / filterAccessibleCustomerIds (H-1)', () => {
  beforeEach(() => {
    resetDb()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key'
  })

  describe('canAccessCustomer', () => {
    it('非管理者 + is_internal_user=true は、Rule A\'が本来成立する場合でもfalse(外舘裕子相当)', async () => {
      const { canAccessCustomer } = await import('@/lib/auth/canAccessCustomer')
      DB.brain_customers = [{ id: 'cust-int-1', store_id: STORE_ID, deleted_at: null, is_internal_user: true }]
      DB.brain_visits = [{ customer_id: 'cust-int-1', staff_id: 'staff-x', visit_date: '2026-06-25', deleted_at: null }]

      await expect(canAccessCustomer('staff-x', 'cust-int-1', false)).resolves.toBe(false)
    })

    it('非管理者 + is_internal_user=true は、最新来店担当が自分と一致してもfalse(鈴木雅子相当・複数来店)', async () => {
      const { canAccessCustomer } = await import('@/lib/auth/canAccessCustomer')
      DB.brain_customers = [{ id: 'cust-int-2', store_id: STORE_ID, deleted_at: null, is_internal_user: true }]
      DB.brain_visits = [
        { customer_id: 'cust-int-2', staff_id: 'staff-y', visit_date: '2026-06-14', deleted_at: null },
        { customer_id: 'cust-int-2', staff_id: 'staff-x', visit_date: '2026-07-23', deleted_at: null },
      ]

      await expect(canAccessCustomer('staff-x', 'cust-int-2', false)).resolves.toBe(false)
    })

    it('非管理者 + is_internal_user=false + Rule A\'一致 → true(既存仕様どおり)', async () => {
      const { canAccessCustomer } = await import('@/lib/auth/canAccessCustomer')
      DB.brain_customers = [{ id: 'cust-a', store_id: STORE_ID, deleted_at: null, is_internal_user: false }]
      DB.brain_visits = [{ customer_id: 'cust-a', staff_id: 'staff-a', visit_date: '2026-06-01', deleted_at: null }]

      await expect(canAccessCustomer('staff-a', 'cust-a', false)).resolves.toBe(true)
    })

    it('非管理者 + is_internal_user=false + Rule B\'一致(本日予約) → true(既存仕様どおり)', async () => {
      const { canAccessCustomer } = await import('@/lib/auth/canAccessCustomer')
      DB.brain_customers = [{ id: 'cust-b', store_id: STORE_ID, deleted_at: null, is_internal_user: false }]
      DB.reservations = [{
        id: 'r1', brain_customer_id: 'cust-b', staff_id: 'auth-b',
        scheduled_at: new Date().toISOString(), status: 'confirmed',
      }]
      DB.brain_staff = [{ id: 'staff-b', user_id: 'auth-b' }]

      await expect(canAccessCustomer('staff-b', 'cust-b', false)).resolves.toBe(true)
    })

    it('非管理者 + is_internal_user=false + 来店・本日予約とも無し(Rule C) → true(既存仕様どおり)', async () => {
      const { canAccessCustomer } = await import('@/lib/auth/canAccessCustomer')
      DB.brain_customers = [{ id: 'cust-c', store_id: STORE_ID, deleted_at: null, is_internal_user: false }]

      await expect(canAccessCustomer('staff-anyone', 'cust-c', false)).resolves.toBe(true)
    })

    it('非管理者 + is_internal_user=false + どのRuleにも該当しない → false(既存仕様どおり)', async () => {
      const { canAccessCustomer } = await import('@/lib/auth/canAccessCustomer')
      DB.brain_customers = [{ id: 'cust-none', store_id: STORE_ID, deleted_at: null, is_internal_user: false }]
      DB.brain_visits = [{ customer_id: 'cust-none', staff_id: 'staff-other', visit_date: '2026-01-01', deleted_at: null }]

      await expect(canAccessCustomer('staff-someone-else', 'cust-none', false)).resolves.toBe(false)
    })

    it('管理者 + is_internal_user=true → true(従来仕様どおり、isAdminで即時許可)', async () => {
      const { canAccessCustomer } = await import('@/lib/auth/canAccessCustomer')
      DB.brain_customers = [{ id: 'cust-int-1', store_id: STORE_ID, deleted_at: null, is_internal_user: true }]
      DB.brain_visits = [{ customer_id: 'cust-int-1', staff_id: 'staff-x', visit_date: '2026-06-25', deleted_at: null }]

      await expect(canAccessCustomer('admin-staff', 'cust-int-1', true)).resolves.toBe(true)
    })

    it('顧客が存在しない(store_id不一致・削除済み等) → false(既存仕様どおり)', async () => {
      const { canAccessCustomer } = await import('@/lib/auth/canAccessCustomer')
      DB.brain_customers = []

      await expect(canAccessCustomer('staff-a', 'cust-missing', false)).resolves.toBe(false)
    })
  })

  describe('filterAccessibleCustomerIds', () => {
    it('非管理者: is_internal_user=trueの顧客は、Rule A\'が本来成立する担当者から見ても候補から除外される', async () => {
      const { filterAccessibleCustomerIds } = await import('@/lib/auth/canAccessCustomer')
      DB.brain_customers = [
        { id: 'cust-int-1', store_id: STORE_ID, deleted_at: null, is_internal_user: true },
        { id: 'cust-int-2', store_id: STORE_ID, deleted_at: null, is_internal_user: true },
        { id: 'cust-c', store_id: STORE_ID, deleted_at: null, is_internal_user: false },
      ]
      DB.brain_visits = [
        { customer_id: 'cust-int-1', staff_id: 'staff-x', visit_date: '2026-06-25', deleted_at: null },
        { customer_id: 'cust-int-2', staff_id: 'staff-y', visit_date: '2026-06-14', deleted_at: null },
        { customer_id: 'cust-int-2', staff_id: 'staff-x', visit_date: '2026-07-23', deleted_at: null },
      ]

      const result = await filterAccessibleCustomerIds(['cust-int-1', 'cust-int-2', 'cust-c'], 'staff-x', false)

      expect(result).toEqual(new Set(['cust-c']))
    })

    it('管理者: is_internal_user=trueも含め全候補がそのまま返る(従来仕様どおり)', async () => {
      const { filterAccessibleCustomerIds } = await import('@/lib/auth/canAccessCustomer')
      DB.brain_customers = [
        { id: 'cust-int-1', store_id: STORE_ID, deleted_at: null, is_internal_user: true },
        { id: 'cust-c', store_id: STORE_ID, deleted_at: null, is_internal_user: false },
      ]

      const result = await filterAccessibleCustomerIds(['cust-int-1', 'cust-c'], 'admin-staff', true)

      expect(result).toEqual(new Set(['cust-int-1', 'cust-c']))
    })

    it('非管理者: Rule A\'一致・Rule不一致・Rule C該当が混在する候補を正しく選別する(既存仕様どおり)', async () => {
      const { filterAccessibleCustomerIds } = await import('@/lib/auth/canAccessCustomer')
      DB.brain_customers = [
        { id: 'cust-a', store_id: STORE_ID, deleted_at: null, is_internal_user: false },
        { id: 'cust-c', store_id: STORE_ID, deleted_at: null, is_internal_user: false },
        { id: 'cust-none', store_id: STORE_ID, deleted_at: null, is_internal_user: false },
      ]
      DB.brain_visits = [
        { customer_id: 'cust-a', staff_id: 'staff-a', visit_date: '2026-06-01', deleted_at: null },
        { customer_id: 'cust-none', staff_id: 'staff-other', visit_date: '2026-01-01', deleted_at: null },
      ]

      const result = await filterAccessibleCustomerIds(['cust-a', 'cust-c', 'cust-none'], 'staff-a', false)

      expect(result).toEqual(new Set(['cust-a', 'cust-c']))
    })

    it('非管理者: Rule B\'一致(本日予約)・Rule C該当が混在する候補を正しく選別する(既存仕様どおり)', async () => {
      const { filterAccessibleCustomerIds } = await import('@/lib/auth/canAccessCustomer')
      DB.brain_customers = [
        { id: 'cust-b', store_id: STORE_ID, deleted_at: null, is_internal_user: false },
        { id: 'cust-c', store_id: STORE_ID, deleted_at: null, is_internal_user: false },
        { id: 'cust-none', store_id: STORE_ID, deleted_at: null, is_internal_user: false },
      ]
      DB.reservations = [{
        id: 'r1', brain_customer_id: 'cust-b', staff_id: 'auth-b',
        scheduled_at: new Date().toISOString(), status: 'confirmed',
      }]
      DB.brain_staff = [{ id: 'staff-b', user_id: 'auth-b' }]
      DB.brain_visits = [{ customer_id: 'cust-none', staff_id: 'staff-other', visit_date: '2026-01-01', deleted_at: null }]

      const result = await filterAccessibleCustomerIds(['cust-b', 'cust-c', 'cust-none'], 'staff-b', false)

      expect(result).toEqual(new Set(['cust-b', 'cust-c']))
    })

    it('候補が空配列 → 空Set(既存仕様どおり、DBアクセスなし)', async () => {
      const { filterAccessibleCustomerIds } = await import('@/lib/auth/canAccessCustomer')
      const result = await filterAccessibleCustomerIds([], 'staff-a', false)
      expect(result).toEqual(new Set())
    })
  })
})
