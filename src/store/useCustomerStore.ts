import { create } from 'zustand';
import { authedFetch } from '@/lib/api/authedFetch';

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
  lineResponseRate: number
  hasNextRebook:    boolean
}

export interface CustomerDebug {
  authUid:    string | null
  role:       string | null
  hasSession: boolean
  rawCount:   number
  statsCount: number
  errorMsg:   string | null
  isMock:     boolean
  rpcError:   string | null
}

interface CustomerState {
  customers:      CustomerRow[]
  isLoading:      boolean
  debug:          CustomerDebug
  fetchCustomers: () => Promise<void>
}

const INIT_DEBUG: CustomerDebug = {
  authUid: null, role: null, hasSession: false,
  rawCount: 0, statsCount: 0, errorMsg: null, isMock: false, rpcError: null,
};

export const useCustomerStore = create<CustomerState>((set) => ({
  customers: [],
  isLoading: false,
  debug:     INIT_DEBUG,

  fetchCustomers: async () => {
    set({ isLoading: true });
    try {
      const res = await authedFetch('/api/customers/list');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const rows = (data.customers ?? []) as CustomerRow[];
      set({
        customers: rows,
        debug: {
          ...INIT_DEBUG,
          rawCount:   rows.length,
          statsCount: rows.filter(r => r.visitCount > 0).length,
          isMock:     false,
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[CustomerStore] fetchCustomers:', msg);
      set({ customers: [], debug: { ...INIT_DEBUG, errorMsg: msg } });
    } finally {
      set({ isLoading: false });
    }
  },
}));
