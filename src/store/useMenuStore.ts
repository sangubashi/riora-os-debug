/**
 * useMenuStore  –  メニュー管理 Zustand ストア
 *
 * ・Supabase から salon_menus / salon_menu_options / salon_menu_analytics を取得
 * ・楽観的 UI 更新 + Supabase 永続化
 */
import { create } from 'zustand'
import { supabase, DEMO_MODE } from '@/lib/supabase'

// ─── Types (src/stores/useMenuStore.ts と互換) ────────────────────────────────
export type MenuCategory = 'facial' | 'option' | 'subscription'
export type MenuTrend    = 'up' | 'down' | 'stable'
export type SortKey      = 'popularity' | 'profit' | 'ai' | 'repeat'
export type FilterTab    = 'all' | MenuCategory

export interface MenuOptionItem {
  id:       string
  name:     string
  price:    number
  duration: number
}

export interface SalonMenuItem {
  id:          string
  name:        string
  category:    MenuCategory
  price:       number
  duration:    number
  isActive:    boolean
  description: string

  rank:              number
  monthlyCount:      number
  repeatRate:        number
  profitMargin:      number
  aiRecommendRate:   number
  nextVisitRate:     number
  upsellSuccessRate: number
  vipConversionRate: number
  trend:             MenuTrend

  isSubscribable:  boolean
  linkedOptionIds: string[]
  lineTags:        string[]
}

export type DraftMenu = Partial<Omit<SalonMenuItem, 'id'>>

// ─── Mock fallback (src/stores/useMenuStore.ts と同一) ───────────────────────

const MOCK_OPTIONS: MenuOptionItem[] = [
  { id:'opt-1', name:'美白トリートメント',  price:3000, duration:20 },
  { id:'opt-2', name:'コラーゲンパック',    price:2000, duration:15 },
  { id:'opt-3', name:'ヘッドスパ',          price:2500, duration:20 },
  { id:'opt-4', name:'アイラッシュケア',    price:1500, duration:10 },
  { id:'opt-5', name:'デコルテマッサージ', price:2000, duration:15 },
]

const MOCK_MENUS: SalonMenuItem[] = [
  { id:'menu-1', name:'プレミアムエイジングケア', category:'facial',       price:18000, duration:90, isActive:true,  description:'厳選成分による最高峰エイジングケア。', rank:1,  monthlyCount:24, repeatRate:82, profitMargin:68, aiRecommendRate:71, nextVisitRate:88, upsellSuccessRate:65, vipConversionRate:24, trend:'up',     isSubscribable:true,  linkedOptionIds:['opt-1','opt-2'], lineTags:['#エイジング','#プレミアム'] },
  { id:'menu-2', name:'モイスチャーフェイシャル', category:'facial',       price:12000, duration:60, isActive:true,  description:'保湿を重視した定番フェイシャル。',     rank:2,  monthlyCount:38, repeatRate:74, profitMargin:62, aiRecommendRate:58, nextVisitRate:78, upsellSuccessRate:42, vipConversionRate:12, trend:'stable', isSubscribable:true,  linkedOptionIds:['opt-2','opt-3'], lineTags:['#保湿'] },
  { id:'menu-3', name:'ポアクリーニングコース',   category:'facial',       price:14000, duration:75, isActive:true,  description:'毛穴の汚れを徹底除去。',               rank:3,  monthlyCount:19, repeatRate:68, profitMargin:58, aiRecommendRate:64, nextVisitRate:72, upsellSuccessRate:38, vipConversionRate:8,  trend:'down',   isSubscribable:false, linkedOptionIds:['opt-1'],         lineTags:['#毛穴'] },
  { id:'menu-4', name:'リラクゼーションコース',   category:'facial',       price:10000, duration:60, isActive:true,  description:'全身リラックスを重視。',               rank:4,  monthlyCount:16, repeatRate:71, profitMargin:60, aiRecommendRate:52, nextVisitRate:75, upsellSuccessRate:35, vipConversionRate:9,  trend:'up',     isSubscribable:true,  linkedOptionIds:['opt-3','opt-5'], lineTags:['#リラクゼーション'] },
  { id:'menu-5', name:'ベーシックフェイシャル',   category:'facial',       price:8000,  duration:45, isActive:true,  description:'初回・体験コース。',                   rank:5,  monthlyCount:11, repeatRate:55, profitMargin:52, aiRecommendRate:38, nextVisitRate:62, upsellSuccessRate:28, vipConversionRate:5,  trend:'stable', isSubscribable:false, linkedOptionIds:[],                lineTags:['#体験'] },
  { id:'menu-7', name:'美白トリートメント',       category:'option',       price:3000,  duration:20, isActive:true,  description:'美白成分集中オプション。',             rank:1,  monthlyCount:28, repeatRate:62, profitMargin:72, aiRecommendRate:66, nextVisitRate:70, upsellSuccessRate:80, vipConversionRate:15, trend:'up',     isSubscribable:false, linkedOptionIds:[],                lineTags:['#美白'] },
  { id:'menu-8', name:'コラーゲンパック',         category:'option',       price:2000,  duration:15, isActive:true,  description:'コラーゲン配合パック。',               rank:2,  monthlyCount:22, repeatRate:58, profitMargin:70, aiRecommendRate:55, nextVisitRate:65, upsellSuccessRate:74, vipConversionRate:10, trend:'stable', isSubscribable:false, linkedOptionIds:[],                lineTags:['#パック'] },
  { id:'menu-9', name:'ベーシックサブスク',       category:'subscription', price:20000, duration:60, isActive:true,  description:'月1回フェイシャル込み。',             rank:1,  monthlyCount:14, repeatRate:94, profitMargin:55, aiRecommendRate:48, nextVisitRate:98, upsellSuccessRate:45, vipConversionRate:18, trend:'up',     isSubscribable:true,  linkedOptionIds:['opt-2'],         lineTags:['#サブスク'] },
  { id:'menu-10',name:'プレミアムサブスク',       category:'subscription', price:35000, duration:90, isActive:true,  description:'月2回施術+オプション1回。',           rank:2,  monthlyCount:8,  repeatRate:98, profitMargin:62, aiRecommendRate:78, nextVisitRate:100,upsellSuccessRate:55, vipConversionRate:35, trend:'up',     isSubscribable:true,  linkedOptionIds:['opt-1','opt-2','opt-3'], lineTags:['#プレミアム','#VIP'] },
]

function sortMenus(menus: SalonMenuItem[], key: SortKey): SalonMenuItem[] {
  return [...menus].sort((a, b) => {
    switch (key) {
      case 'popularity': return a.rank - b.rank
      case 'profit':     return b.profitMargin - a.profitMargin
      case 'ai':         return b.aiRecommendRate - a.aiRecommendRate
      case 'repeat':     return b.repeatRate - a.repeatRate
    }
  })
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface MenuStore {
  menus:   SalonMenuItem[]
  options: MenuOptionItem[]

  filterTab: FilterTab
  sortBy:    SortKey

  editingMenu:          SalonMenuItem | null
  draft:                DraftMenu
  isEditOpen:           boolean
  isAddOpen:            boolean
  isOptionSelectorOpen: boolean

  isLoading: boolean
  error:     string | null

  // selectors
  filteredMenus: () => SalonMenuItem[]

  // view
  setFilter: (tab: FilterTab) => void
  setSortBy: (key: SortKey)   => void

  // edit
  openEdit:    (menu: SalonMenuItem) => void
  closeEdit:   () => void
  updateDraft: (updates: DraftMenu)  => void
  saveEdit:    () => Promise<void>

  // add
  openAdd:  () => void
  closeAdd: () => void

  // option selector
  openOptionSelector:  () => void
  closeOptionSelector: () => void

  // inline
  toggleActive: (id: string) => Promise<void>

  // Supabase fetch
  fetchMenus:     () => Promise<void>
  fetchOptions:   () => Promise<void>
  fetchAnalytics: (menuId: string) => Promise<Partial<SalonMenuItem>>
}

export const useMenuStore = create<MenuStore>((set, get) => ({
  menus:   MOCK_MENUS,
  options: MOCK_OPTIONS,

  filterTab: 'all',
  sortBy:    'popularity',

  editingMenu:          null,
  draft:                {},
  isEditOpen:           false,
  isAddOpen:            false,
  isOptionSelectorOpen: false,

  isLoading: false,
  error:     null,

  filteredMenus: () => {
    const { menus, filterTab, sortBy } = get()
    const filtered = filterTab === 'all' ? menus : menus.filter(m => m.category === filterTab)
    return sortMenus(filtered, sortBy)
  },

  setFilter: (tab) => set({ filterTab: tab }),
  setSortBy: (key) => set({ sortBy: key }),

  openEdit:    (menu) => set({ editingMenu: menu, draft: { ...menu }, isEditOpen: true }),
  closeEdit:   ()     => set({ isEditOpen: false, editingMenu: null, draft: {} }),
  updateDraft: (u)    => set(s => ({ draft: { ...s.draft, ...u } })),

  saveEdit: async () => {
    const { editingMenu, draft, menus } = get()
    if (!editingMenu) return

    // Optimistic UI
    const updated = { ...editingMenu, ...draft } as SalonMenuItem
    set({
      menus:     menus.map(m => m.id === editingMenu.id ? updated : m),
      isEditOpen:    false,
      editingMenu:   null,
      draft:         {},
    })

    if (DEMO_MODE) return
    await supabase.from('salon_menus').update({
      name:            draft.name,
      price:           draft.price,
      duration:        draft.duration,
      is_active:       draft.isActive,
      description:     draft.description,
      is_subscribable: draft.isSubscribable,
      line_tags:       draft.lineTags,
      updated_at:      new Date().toISOString(),
    }).eq('id', editingMenu.id)
  },

  openAdd:  () => set({ draft:{ category:'facial', isActive:true, isSubscribable:false, linkedOptionIds:[], lineTags:[] }, isAddOpen:true }),
  closeAdd: () => set({ isAddOpen:false, draft:{} }),

  openOptionSelector:  () => set({ isOptionSelectorOpen: true }),
  closeOptionSelector: () => set({ isOptionSelectorOpen: false }),

  toggleActive: async (id) => {
    const menu = get().menus.find(m => m.id === id)
    if (!menu) return
    const next = !menu.isActive

    set(s => ({ menus: s.menus.map(m => m.id === id ? { ...m, isActive: next } : m) }))
    if (DEMO_MODE) return
    await supabase.from('salon_menus')
      .update({ is_active: next, updated_at: new Date().toISOString() })
      .eq('id', id)
  },

  // ── fetchMenus ─────────────────────────────────────────────────
  fetchMenus: async () => {
    if (DEMO_MODE) return
    set({ isLoading: true })
    try {
      const { data: menus, error } = await supabase
        .from('salon_menus')
        .select('*, salon_menu_options(option_id)')
        .order('display_order', { ascending: true })

      if (error || !menus || menus.length === 0) { set({ isLoading: false }); return }

      // Fetch analytics for active menus
      const menuIds = menus.filter((m: { is_active: boolean }) => m.is_active).map((m: { id: string }) => m.id)
      const { data: analytics } = await supabase
        .from('salon_menu_analytics')
        .select('*')
        .in('menu_id', menuIds)
        .order('period_end', { ascending: false })

      const analyticsMap: Record<string, typeof analytics extends (infer T)[] | null ? T : never> = {}
      if (analytics) {
        analytics.forEach((a: { menu_id: string }) => {
          if (!analyticsMap[a.menu_id]) analyticsMap[a.menu_id] = a
        })
      }

      set({
        menus: menus.map((m: {
          id: string; name: string; category: MenuCategory; price: number; duration: number;
          is_active: boolean; description: string; is_subscribable: boolean;
          line_tags: string[]; display_order: number;
          salon_menu_options: { option_id: string }[]
        }, i: number) => {
          const a = analyticsMap[m.id] as {
            treatment_count?: number; repeat_rate?: number; profit_margin?: number;
            ai_recommend_rate?: number; next_visit_rate?: number;
            upsell_success_rate?: number; vip_conversion_rate?: number
          } | undefined
          const mock = MOCK_MENUS.find(mo => mo.name === m.name)
          return {
            id:          m.id,
            name:        m.name,
            category:    m.category,
            price:       m.price,
            duration:    m.duration,
            isActive:    m.is_active,
            description: m.description ?? '',
            isSubscribable:  m.is_subscribable,
            linkedOptionIds: (m.salon_menu_options ?? []).map((o: { option_id: string }) => o.option_id),
            lineTags:    m.line_tags ?? [],
            rank:        i + 1,
            monthlyCount:      a?.treatment_count       ?? mock?.monthlyCount      ?? 0,
            repeatRate:        Number(a?.repeat_rate)        || mock?.repeatRate        || 0,
            profitMargin:      Number(a?.profit_margin)      || mock?.profitMargin      || 0,
            aiRecommendRate:   Number(a?.ai_recommend_rate)  || mock?.aiRecommendRate   || 0,
            nextVisitRate:     Number(a?.next_visit_rate)    || mock?.nextVisitRate     || 0,
            upsellSuccessRate: Number(a?.upsell_success_rate)|| mock?.upsellSuccessRate || 0,
            vipConversionRate: Number(a?.vip_conversion_rate)|| mock?.vipConversionRate || 0,
            trend: mock?.trend ?? 'stable',
          } satisfies SalonMenuItem
        }),
      })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'メニューの取得に失敗しました' })
    } finally {
      set({ isLoading: false })
    }
  },

  fetchOptions: async () => {
    try {
      const { data } = await supabase
        .from('salon_menus')
        .select('id, name, price, duration')
        .eq('category', 'option')
        .eq('is_active', true)
        .order('display_order', { ascending: true })

      if (data && data.length > 0) {
        set({ options: data as MenuOptionItem[] })
      }
    } catch { /* fallback */ }
  },

  fetchAnalytics: async (menuId) => {
    const { data } = await supabase
      .from('salon_menu_analytics')
      .select('*')
      .eq('menu_id', menuId)
      .order('period_end', { ascending: false })
      .limit(1)
      .single()

    if (!data) return {}
    return {
      monthlyCount:      data.treatment_count,
      repeatRate:        Number(data.repeat_rate),
      profitMargin:      Number(data.profit_margin),
      aiRecommendRate:   Number(data.ai_recommend_rate),
      nextVisitRate:     Number(data.next_visit_rate),
      upsellSuccessRate: Number(data.upsell_success_rate),
      vipConversionRate: Number(data.vip_conversion_rate),
    }
  },
}))
