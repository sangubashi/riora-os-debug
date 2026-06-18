import { create } from 'zustand'
import { supabase, DEMO_MODE, VOICE_NOTES_LIVE } from '@/lib/supabase'
import type { UserRole } from '@/types/database'

// ─── 型 ──────────────────────────────────────────────────────────────────────

export type CustomerType =
  | 'VIP型'
  | '慎重・不安型'
  | '感情重視型'
  | '効果重視型'
  | '信頼構築型'

export interface CustomerRow {
  id:               string
  name:             string
  type:             CustomerType
  visitCount:       number
  totalSpent:       number
  churnRisk:        number
  lastVisit:        number
  lastVisitDate:    string | null
  isVip:            boolean
  assignedStaffId:  string | null
  treatments:       string[]
  staffName:        string
  lineResponseRate: number   // LINE返信率 (0〜100)
  hasNextRebook:    boolean  // 次回予約あり
}

export interface CustomerDebug {
  authUid:      string | null
  role:         UserRole | null
  hasSession:   boolean
  rawCount:     number
  statsCount:   number            // RPC で取得できた集計件数
  errorMsg:     string | null
  isMock:       boolean
  rpcError:     string | null
}

interface CustomerState {
  customers:      CustomerRow[]
  isLoading:      boolean
  debug:          CustomerDebug
  fetchCustomers: () => Promise<void>
}

// ─── RPC レスポンス型 ─────────────────────────────────────────────────────────

interface CustomerStat {
  customer_id: string
  visit_count: number | string
  total_sales: number | string
  last_visit:  string | null
}

// ─── ヘルパー ─────────────────────────────────────────────────────────────────

const VALID_TYPES = new Set<CustomerType>([
  'VIP型', '慎重・不安型', '感情重視型', '効果重視型', '信頼構築型',
])

function toCustomerType(s: string | null): CustomerType {
  if (s && VALID_TYPES.has(s as CustomerType)) return s as CustomerType
  return '信頼構築型'
}

function daysAgo(dateStr: string | null): number {
  if (!dateStr) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000))
}

function isMockMode(): boolean {
  if (DEMO_MODE && !VOICE_NOTES_LIVE) return true
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  return !url || !key || url === '' || key === ''
}

// ─── モック顧客データ ─────────────────────────────────────────────────────────

const MOCK_CUSTOMERS: CustomerRow[] = [
  { id:'c-1', name:'田中 美咲',   type:'VIP型',       visitCount:12, totalSpent:216000, churnRisk:8,  lastVisit:14, lastVisitDate:'2026-05-05', isVip:true,  assignedStaffId:null, treatments:['プレミアムエイジングケア','ハーブピーリング'], staffName:'鈴木',  lineResponseRate:75, hasNextRebook:true  },
  { id:'c-2', name:'高橋 ゆり',   type:'VIP型',       visitCount:18, totalSpent:324000, churnRisk:5,  lastVisit:7,  lastVisitDate:'2026-05-12', isVip:true,  assignedStaffId:null, treatments:['プレミアムエイジングケア','ホワイトニングケア'], staffName:'亀山', lineResponseRate:82, hasNextRebook:true  },
  { id:'c-3', name:'松本 みれい', type:'VIP型',       visitCount:14, totalSpent:252000, churnRisk:10, lastVisit:10, lastVisitDate:'2026-05-09', isVip:true,  assignedStaffId:null, treatments:['プレミアムエイジングケア'], staffName:'外舘',          lineResponseRate:68, hasNextRebook:true  },
  { id:'c-4', name:'佐藤 明子',   type:'効果重視型',   visitCount:9,  totalSpent:135000, churnRisk:18, lastVisit:18, lastVisitDate:'2026-05-01', isVip:false, assignedStaffId:null, treatments:['ハーブピーリング'], staffName:'鈴木',              lineResponseRate:55, hasNextRebook:false },
  { id:'c-5', name:'伊藤 さくら', type:'信頼構築型',   visitCount:6,  totalSpent:72000,  churnRisk:30, lastVisit:21, lastVisitDate:'2026-04-28', isVip:false, assignedStaffId:null, treatments:['モイスチャーフェイシャル'], staffName:'亀山',          lineResponseRate:60, hasNextRebook:false },
  { id:'c-6', name:'鈴木 花子',   type:'感情重視型',   visitCount:4,  totalSpent:48000,  churnRisk:25, lastVisit:32, lastVisitDate:'2026-04-17', isVip:false, assignedStaffId:null, treatments:['モイスチャーフェイシャル'], staffName:'外舘',          lineResponseRate:40, hasNextRebook:false },
  { id:'c-7', name:'渡辺 あやか', type:'効果重視型',   visitCount:3,  totalSpent:36000,  churnRisk:42, lastVisit:28, lastVisitDate:'2026-04-21', isVip:false, assignedStaffId:null, treatments:['ハーブピーリング'], staffName:'鈴木',              lineResponseRate:35, hasNextRebook:false },
  { id:'c-8', name:'山田 美沙',   type:'慎重・不安型', visitCount:5,  totalSpent:60000,  churnRisk:76, lastVisit:62, lastVisitDate:'2026-03-18', isVip:false, assignedStaffId:null, treatments:['ホワイトニングケア'], staffName:'亀山',            lineResponseRate:20, hasNextRebook:false },
]

// ─── 初期 debug ───────────────────────────────────────────────────────────────

const INIT_DEBUG: CustomerDebug = {
  authUid: null, role: null, hasSession: false,
  rawCount: 0, statsCount: 0, errorMsg: null, isMock: false, rpcError: null,
}

// ─── ストア ───────────────────────────────────────────────────────────────────

export const useCustomerStore = create<CustomerState>((set) => ({
  customers: [],
  isLoading: false,
  debug:     INIT_DEBUG,

  fetchCustomers: async () => {
    if (isMockMode()) {
      set({ customers: MOCK_CUSTOMERS, debug: { ...INIT_DEBUG, isMock: true, rawCount: MOCK_CUSTOMERS.length } })
      return
    }

    set({ isLoading: true })
    try {
      // ① セッション確認
      const { data: { session } } = await supabase.auth.getSession()
      const uid = session?.user?.id ?? null
      console.log('[CustomerStore] ── fetchCustomers 開始 ──')
      console.log('[CustomerStore] session:', session ? 'あり' : 'なし', '/ uid:', uid ?? 'なし')

      if (!session || !uid) {
        if (DEMO_MODE) {
          console.warn('[CustomerStore] DEMO_MODE: 未認証 → MOCK_CUSTOMERSにフォールバック')
          set({ customers: MOCK_CUSTOMERS, isLoading: false, debug: { ...INIT_DEBUG, isMock: true, rawCount: MOCK_CUSTOMERS.length } })
          return
        }
        set({ customers: [], debug: { ...INIT_DEBUG, errorMsg: '未認証' } })
        return
      }

      // ② ロール取得（失敗してもフォールバックで続行）
      const { data: profile, error: profileErr } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', uid)
        .single()
      if (profileErr) {
        console.error('[CustomerStore] profiles取得失敗:', profileErr.code, profileErr.message,
          '→ role=null として全件表示で続行')
      }
      const role: UserRole | null = (profile?.role as UserRole) ?? null
      console.log('[CustomerStore] role:', role ?? 'null (全件表示モード)')

      // ③ customers マスタ取得
      const { data, error: custErr } = await supabase
        .from('customers')
        .select('id, name, customer_type, is_vip, churn_risk_score, assigned_staff_id')
        .order('name')

      if (custErr) {
        const msg = custErr.message
        console.error('[CustomerStore] customers クエリエラー:', custErr.code, msg)
        set({ customers: [], debug: { ...INIT_DEBUG, authUid: uid, role, hasSession: true, errorMsg: msg } })
        return
      }
      if (!data?.length) {
        console.warn('[CustomerStore] customers: 0件返却（RLSポリシーまたはデータなし）')
        if (DEMO_MODE) {
          console.warn('[CustomerStore] DEMO_MODE: DBデータ0件 → MOCK_CUSTOMERSにフォールバック')
          set({ customers: MOCK_CUSTOMERS, isLoading: false, debug: { ...INIT_DEBUG, isMock: true, rawCount: MOCK_CUSTOMERS.length } })
          return
        }
        set({ customers: [], debug: { ...INIT_DEBUG, authUid: uid, role, hasSession: true, errorMsg: 'データ0件' } })
        return
      }

      // ④ フィルタ（fail-closed: profile取得失敗時は空表示 / DEMO_MODEはMOCKにフォールバック）
      if (!role) {
        if (DEMO_MODE) {
          console.warn('[CustomerStore] DEMO_MODE: profiles取得失敗 → MOCK_CUSTOMERSにフォールバック')
          set({ customers: MOCK_CUSTOMERS, isLoading: false, debug: { ...INIT_DEBUG, isMock: true, rawCount: MOCK_CUSTOMERS.length } })
          return
        }
        console.warn('[CustomerStore] profiles取得失敗 → fail-closed: 顧客表示を空にします')
        set({
          customers: [],
          isLoading: false,
          debug: { ...INIT_DEBUG, authUid: uid, hasSession: true, errorMsg: 'profiles取得失敗', role: null },
        })
        return
      }
      const canSeeAll = role === 'owner'
      const filtered = canSeeAll
        ? data
        : data.filter(r => String(r.assigned_staff_id) === String(uid))

      console.log(`[CustomerStore] DB取得: ${data.length}件 / フィルタ後: ${filtered.length}件 (canSeeAll=${canSeeAll})`)

      if (!filtered.length && DEMO_MODE) {
        console.warn('[CustomerStore] DEMO_MODE: staffフィルタ後0件 → MOCK_CUSTOMERSにフォールバック')
        set({ customers: MOCK_CUSTOMERS, isLoading: false, debug: { ...INIT_DEBUG, isMock: true, rawCount: MOCK_CUSTOMERS.length } })
        return
      }

      // ⑤ RPC で reservations 集計（失敗しても customers 表示は継続）
      let rpcError: string | null = null

      const { data: statsData, error: statsErr } = await supabase
        .rpc('get_customer_stats')

      if (statsErr) {
        rpcError = statsErr.message
        console.error('[CustomerStore] RPC get_customer_stats エラー:', statsErr.code, statsErr.message,
          '→ 来店回数・売上なしで表示継続')
      }

      console.log('[MERGE] filtered ids (先頭3件):',
        filtered.slice(0, 3).map(r => ({ id: r.id, name: r.name }))
      )

      // ── statsMap を構築（キーを小文字に正規化）──
      const statsMap: Record<string, {
        visitCount: number; totalSpent: number; lastVisitDate: string | null
      }> = {}

      if (statsData) {
        ;(statsData as CustomerStat[]).forEach(s => {
          // Supabase が bigint を string で返す場合も Number() で吸収
          const visitCount = Number(s.visit_count)  || 0
          const totalSpent = Number(s.total_sales)  || 0
          // キーを小文字・trim 済みで格納（UUID大文字ズレを防ぐ）
          const key = String(s.customer_id).toLowerCase().trim()
          statsMap[key] = {
            visitCount,
            totalSpent,
            lastVisitDate: s.last_visit ?? null,
          }
          console.log(
            `[RPC] ${key.slice(0, 8)}… | ${visitCount}回 | ¥${totalSpent.toLocaleString('ja-JP')} | ${s.last_visit ?? '-'}`
          )
        })
        console.log('[MERGE] statsMap に格納されたキー数:', Object.keys(statsMap).length)
      }

      // ⑥ CustomerRow へ変換（キーを同じく小文字・trim で照合）
      const rows: CustomerRow[] = filtered.map(r => {
        const key   = String(r.id).toLowerCase().trim()
        const stats = statsMap[key]

        // ▼ 各顧客のマージ結果を出力
        console.log(
          `[MERGE] ${r.name.padEnd(12)} id=${key.slice(0,8)}…` +
          ` hit=${!!stats}` +
          ` visitCount=${stats?.visitCount ?? 'MISS'}` +
          ` totalSpent=${stats?.totalSpent ?? 'MISS'}`
        )

        const visitCount    = stats?.visitCount    ?? 0
        const totalSpent    = stats?.totalSpent    ?? 0
        const lastVisitDate = stats?.lastVisitDate ?? null

        return {
          id:              r.id,
          name:            r.name,
          type:            toCustomerType(r.customer_type),
          visitCount,
          totalSpent,
          churnRisk:       r.churn_risk_score ?? 0,
          lastVisit:       daysAgo(lastVisitDate),
          lastVisitDate,
          isVip:           r.is_vip ?? false,
          assignedStaffId: r.assigned_staff_id ?? null,
          treatments:      (r as Record<string, unknown>)['suggested_menu'] ? [(r as Record<string, unknown>)['suggested_menu'] as string] : [],
          staffName:       ((r as Record<string, unknown>)['assigned_staff_id'] as string | null) ?? '',
          lineResponseRate: Number((r as Record<string, unknown>)['line_response_rate'] ?? 50),
          hasNextRebook:    Boolean((r as Record<string, unknown>)['has_next_rebook'] ?? false),
        }
      })

      rows.sort((a, b) => b.totalSpent - a.totalSpent)

      set({
        customers: rows,
        debug: {
          authUid:    uid,
          role,
          hasSession: true,
          rawCount:   data.length,
          statsCount: Object.keys(statsMap).length,
          errorMsg:   null,
          isMock:     false,
          rpcError,
        },
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[CustomerStore] 予期せぬエラー:', msg)
      set({ customers: [], debug: { ...INIT_DEBUG, errorMsg: msg } })
    } finally {
      set({ isLoading: false })
    }
  },
}))
