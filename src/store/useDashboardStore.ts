/**
 * useDashboardStore  –  Salon Riora OS ダッシュボード統合ストア
 *
 * 役割:
 *  ① Auth / Session 管理
 *  ② ナビゲーション状態
 *  ③ 通知バッジ
 *  ④ 今日の予約リスト（Phase1 ホーム画面）
 *  ⑤ LINE未返信サマリー
 *  ⑥ ダッシュボード集計値（本日売上・件数）
 */
import { create } from 'zustand'
import { persist, type StorageValue } from 'zustand/middleware'

/** Safari ITP で localStorage がブロックされても止まらないストレージ */
function createSafariSafeStorage() {
  return {
    getItem: (name: string): StorageValue<unknown> | null => {
      try {
        const v = localStorage.getItem(name)
        return v ? (JSON.parse(v) as StorageValue<unknown>) : null
      } catch { return null }
    },
    setItem: (name: string, value: StorageValue<unknown>): void => {
      try { localStorage.setItem(name, JSON.stringify(value)) } catch { /* silent */ }
    },
    removeItem: (name: string): void => {
      try { localStorage.removeItem(name) } catch { /* silent */ }
    },
  }
}
import { supabase } from '@/lib/supabase'

// ─── 型定義 ──────────────────────────────────────────────────────────────────

export type AppScreen = 'splash' | 'login' | 'home' | 'kpi' | 'line' | 'menu' | 'phase1'
export type UserRole  = 'owner' | 'admin' | 'staff' | null

export interface DashboardNotification {
  id:        string
  type:      'warning' | 'info' | 'success'
  message:   string
  createdAt: string
  read:      boolean
}

/** 今日の予約サマリー（Supabase reservations ↔ Phase1Screen の橋渡し） */
export interface TodayReservation {
  id:              string
  customerId:      string | null
  customerName:    string
  customerType:    string
  scheduledAt:     string
  durationMinutes: number
  menu:            string
  isVip:           boolean
  churnRisk:       number
  staffId:         string
  status:          string
  aiScore:         number
  visitCount:      number
  totalSpent:      number
  daysSinceLastVisit: number
  lineTags:        string[]
}

/** LINE未返信顧客サマリー */
export interface LineUnreadItem {
  customerId:   string
  customerName: string
  lastMessage:  string
  unreadCount:  number
  timeAgo:      string
  churnRisk:    number
}

// ─── State / Actions 型 ──────────────────────────────────────────────────────

interface DashboardState {
  // ① Auth
  currentStaffId:   string | null
  currentStaffName: string | null
  userRole:         UserRole
  isAuthenticated:  boolean

  // ② Navigation
  activeScreen: AppScreen
  prevScreen:   AppScreen | null

  // ③ Notifications
  notifications: DashboardNotification[]
  unreadCount:   number

  // ④ Today's Reservations
  todayReservations:        TodayReservation[]
  reservationsLoading:      boolean
  reservationsLastFetchedAt: string | null

  // ⑤ LINE Unread
  lineUnreadCount:     number
  lineUnreadItems:     LineUnreadItem[]
  lineUnreadLoading:   boolean

  // ⑥ Dashboard Summary
  todayRevenue:          number
  todayReservationCount: number

  // App
  isOnline:     boolean
  lastSyncedAt: string | null

  // ── Actions ──────────────────────────────────────────────────────────
  // Auth
  setCurrentStaff: (id: string, name: string, role: UserRole) => void
  clearSession:    () => void

  // Navigation
  navigateTo: (screen: AppScreen) => void

  // Notifications
  addNotification:    (n: Omit<DashboardNotification, 'id' | 'createdAt' | 'read'>) => void
  markAllRead:        () => void
  clearNotifications: () => void

  // Reservations
  fetchTodayReservations: (staffId?: string) => Promise<void>
  setTodayReservations:   (list: TodayReservation[]) => void

  // LINE
  fetchLineUnread:      () => Promise<void>
  incrementLineUnread:  () => void
  decrementLineUnread:  () => void

  // Summary
  fetchDashboardSummary: (staffId?: string) => Promise<void>

  // App
  setOnline:     (online: boolean) => void
  setLastSynced: () => void
}

// ─── Mock fallback ───────────────────────────────────────────────────────────

function todayAt(h: number, m = 0) {
  const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString()
}

const MOCK_RESERVATIONS: TodayReservation[] = [
  { id:'r-1', customerId:'c-1', customerName:'田中 美咲',   customerType:'VIP型',       scheduledAt:todayAt(10,0),  durationMinutes:90, menu:'プレミアムエイジングケア',   isVip:true,  churnRisk:12, staffId:'kameyama', status:'confirmed', aiScore:92, visitCount:8,  totalSpent:248000, daysSinceLastVisit:14, lineTags:['#毛穴','#たるみ'] },
  { id:'r-2', customerId:'c-2', customerName:'鈴木 花子',   customerType:'感情重視型',   scheduledAt:todayAt(11,30), durationMinutes:60, menu:'モイスチャーフェイシャル',   isVip:false, churnRisk:18, staffId:'kameyama', status:'confirmed', aiScore:68, visitCount:3,  totalSpent:24000,  daysSinceLastVisit:45, lineTags:['#保湿','#敏感肌'] },
  { id:'r-3', customerId:'c-3', customerName:'佐藤 明子',   customerType:'効果重視型',   scheduledAt:todayAt(13,0),  durationMinutes:75, menu:'ポアクリーニング + 美白ケア', isVip:false, churnRisk:22, staffId:'kameyama', status:'confirmed', aiScore:85, visitCount:9,  totalSpent:148000, daysSinceLastVisit:18, lineTags:['#美白','#毛穴'] },
  { id:'r-4', customerId:'c-4', customerName:'山田 美沙',   customerType:'慎重・不安型', scheduledAt:todayAt(14,30), durationMinutes:60, menu:'ベーシックフェイシャル',     isVip:false, churnRisk:76, staffId:'kameyama', status:'confirmed', aiScore:45, visitCount:5,  totalSpent:40000,  daysSinceLastVisit:62, lineTags:['#乾燥'] },
  { id:'r-5', customerId:'c-5', customerName:'高橋 ゆり',   customerType:'VIP型',       scheduledAt:todayAt(16,0),  durationMinutes:90, menu:'プレミアムエイジングケア',   isVip:true,  churnRisk:5,  staffId:'kameyama', status:'confirmed', aiScore:94, visitCount:18, totalSpent:342000, daysSinceLastVisit:7,  lineTags:['#エイジング','#VIP'] },
  { id:'r-6', customerId:'c-6', customerName:'伊藤 さくら', customerType:'信頼構築型',   scheduledAt:todayAt(17,30), durationMinutes:60, menu:'リラクゼーションコース',     isVip:false, churnRisk:14, staffId:'kameyama', status:'confirmed', aiScore:72, visitCount:6,  totalSpent:72000,  daysSinceLastVisit:28, lineTags:['#リラックス'] },
]

const MOCK_LINE_UNREADS: LineUnreadItem[] = [
  { customerId:'c-4', customerName:'山田 美沙',   lastMessage:'予約の変更について確認したいのですが…',          unreadCount:3, timeAgo:'2時間前',  churnRisk:76 },
  { customerId:'c-6', customerName:'伊藤 さくら', lastMessage:'次回いつ頃空いていますか？',                      unreadCount:1, timeAgo:'5時間前',  churnRisk:14 },
  { customerId:'c-2', customerName:'鈴木 花子',   lastMessage:'ありがとうございました！またよろしくお願いします', unreadCount:2, timeAgo:'昨日',     churnRisk:18 },
]

// ─── Store ────────────────────────────────────────────────────────────────────

export const useDashboardStore = create<DashboardState>()(
  persist(
    (set, get) => ({
      // ── Initial state ──────────────────────────────────────────────────────
      currentStaffId:   null,
      currentStaffName: null,
      userRole:         null,
      isAuthenticated:  false,

      activeScreen: 'splash',
      prevScreen:   null,

      notifications: [],
      unreadCount:   0,

      todayReservations:         MOCK_RESERVATIONS,
      reservationsLoading:       false,
      reservationsLastFetchedAt: null,

      lineUnreadCount:   MOCK_LINE_UNREADS.reduce((s, i) => s + i.unreadCount, 0),
      lineUnreadItems:   MOCK_LINE_UNREADS,
      lineUnreadLoading: false,

      todayRevenue:          MOCK_RESERVATIONS.length * 14000,
      todayReservationCount: MOCK_RESERVATIONS.length,

      isOnline:     true,
      lastSyncedAt: null,

      // ── Auth ───────────────────────────────────────────────────────────────
      setCurrentStaff: (id, name, role) =>
        set({ currentStaffId: id, currentStaffName: name, userRole: role, isAuthenticated: true }),

      clearSession: () =>
        set({ currentStaffId: null, currentStaffName: null, userRole: null, isAuthenticated: false }),

      // ── Navigation ─────────────────────────────────────────────────────────
      navigateTo: (screen) =>
        set(s => ({ prevScreen: s.activeScreen, activeScreen: screen })),

      // ── Notifications ───────────────────────────────────────────────────────
      addNotification: (n) => {
        const item: DashboardNotification = {
          id:        crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          read:      false,
          ...n,
        }
        set(s => ({
          notifications: [item, ...s.notifications].slice(0, 50),
          unreadCount:   s.unreadCount + 1,
        }))
      },

      markAllRead: () =>
        set(s => ({ notifications: s.notifications.map(n => ({ ...n, read: true })), unreadCount: 0 })),

      clearNotifications: () => set({ notifications: [], unreadCount: 0 }),

      // ── Today's Reservations ───────────────────────────────────────────────
      setTodayReservations: (list) =>
        set({ todayReservations: list, todayReservationCount: list.length }),

      fetchTodayReservations: async (staffId) => {
        const sid = staffId ?? get().currentStaffId
        set({ reservationsLoading: true })
        try {
          const todayStart = new Date(); todayStart.setHours(0,0,0,0)
          const todayEnd   = new Date(); todayEnd.setHours(23,59,59,999)

          let query = supabase
            .from('reservations')
            .select('*')
            .gte('scheduled_at', todayStart.toISOString())
            .lte('scheduled_at', todayEnd.toISOString())
            .in('status', ['confirmed','in_progress'])
            .order('scheduled_at', { ascending: true })

          if (sid) query = query.eq('staff_id', sid)

          const { data, error } = await query.limit(20)
          if (error || !data || data.length === 0) return

          const mapped: TodayReservation[] = data.map((r: {
            id: string; customer_id: string | null; customer_name: string;
            customer_type: string; scheduled_at: string; duration_minutes: number;
            menu: string; is_vip: boolean; churn_risk: number; staff_id: string;
            status: string; days_since_last_visit: number
          }) => ({
            id:              r.id,
            customerId:      r.customer_id,
            customerName:    r.customer_name,
            customerType:    r.customer_type,
            scheduledAt:     r.scheduled_at,
            durationMinutes: r.duration_minutes,
            menu:            r.menu,
            isVip:           r.is_vip,
            churnRisk:       r.churn_risk,
            staffId:         r.staff_id,
            status:          r.status,
            aiScore:         70,
            visitCount:      0,
            totalSpent:      0,
            daysSinceLastVisit: r.days_since_last_visit,
            lineTags:        [],
          }))

          set({
            todayReservations:         mapped,
            todayReservationCount:     mapped.length,
            reservationsLastFetchedAt: new Date().toISOString(),
          })
        } catch { /* fallback to mock */ } finally {
          set({ reservationsLoading: false })
        }
      },

      // ── LINE Unread ─────────────────────────────────────────────────────────
      incrementLineUnread: () =>
        set(s => ({ lineUnreadCount: s.lineUnreadCount + 1 })),

      decrementLineUnread: () =>
        set(s => ({ lineUnreadCount: Math.max(0, s.lineUnreadCount - 1) })),

      fetchLineUnread: async () => {
        set({ lineUnreadLoading: true })
        try {
          const { data } = await supabase
            .from('line_threads')
            .select('customer_id, customer_name, last_message, unread_count, last_message_at, churn_risk')
            .gt('unread_count', 0)
            .order('last_message_at', { ascending: false })
            .limit(10)

          if (!data || data.length === 0) return

          const items: LineUnreadItem[] = data.map((r: {
            customer_id: string; customer_name: string; last_message: string;
            unread_count: number; last_message_at: string; churn_risk: number
          }) => {
            const mins = Math.floor((Date.now() - new Date(r.last_message_at).getTime()) / 60000)
            const timeAgo = mins < 60 ? `${mins}分前`
              : mins < 1440 ? `${Math.floor(mins/60)}時間前`
              : '昨日'
            return {
              customerId:   r.customer_id,
              customerName: r.customer_name,
              lastMessage:  r.last_message,
              unreadCount:  r.unread_count,
              timeAgo,
              churnRisk:    r.churn_risk ?? 0,
            }
          })

          set({
            lineUnreadItems: items,
            lineUnreadCount: items.reduce((s, i) => s + i.unreadCount, 0),
          })
        } catch { /* fallback to mock */ } finally {
          set({ lineUnreadLoading: false })
        }
      },

      // ── Dashboard Summary ───────────────────────────────────────────────────
      fetchDashboardSummary: async (staffId) => {
        const sid = staffId ?? get().currentStaffId
        try {
          const today = new Date().toISOString().split('T')[0]
          const { data } = await supabase
            .from('daily_kpi_snapshots')
            .select('total_sales, reservation_count')
            .eq('date', today)
            .maybeSingle()

          if (data) {
            set({
              todayRevenue:          data.total_sales        ?? 0,
              todayReservationCount: data.reservation_count  ?? 0,
            })
          }

          await Promise.allSettled([
            get().fetchTodayReservations(sid ?? undefined),
            get().fetchLineUnread(),
          ])
        } catch { /* silent */ }
      },

      // ── App ────────────────────────────────────────────────────────────────
      setOnline:     (online) => set({ isOnline: online }),
      setLastSynced: ()       => set({ lastSyncedAt: new Date().toISOString() }),
    }),
    {
      name: 'riora-dashboard',
      partialize: (s) => ({
        currentStaffId:   s.currentStaffId,
        currentStaffName: s.currentStaffName,
        userRole:         s.userRole,
        isAuthenticated:  s.isAuthenticated,
      }),
      // Safari ITP: localStorage が使えない場合でも止まらない安全ストレージ
      storage: createSafariSafeStorage(),
    }
  )
)
