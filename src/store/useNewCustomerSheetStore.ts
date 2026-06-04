'use client'
/**
 * useNewCustomerSheetStore.ts — 統合版 CustomerBottomSheet 専用 store
 *
 * 設計原則:
 *   - useStaffStore / useAuthStore など既存 store と完全隔離
 *   - Zustand key 衝突なし（prefix: newSheet_）
 *   - デバッグログ付き（console.group で見やすく）
 *   - Safari: body scroll lock を open/close で制御
 */

import { create } from 'zustand'
import type { Customer, Reservation, ServicePhase } from '@/types'

// ─── 型 ──────────────────────────────────────────────────────────────────────

export interface NewSheetActiveSession {
  servicePhase: ServicePhase
  timePressure: boolean
  elapsedSec:   number
}

export interface NextActionState {
  actions:   string[]
  loading:   boolean
  generated: boolean
}

export interface NewSheetState {
  isOpen:            boolean
  customer:          Customer | null
  reservation:       Reservation | null
  activeSession:     NewSheetActiveSession
  isRecording:       boolean
  aiLoadingSections: Set<string>
  timelineExpanded:  boolean
  nextActionState:   NextActionState

  open:                (c: Customer, r: Reservation) => void
  close:               () => void
  setServicePhase:     (p: ServicePhase) => void
  setTimePressure:     (v: boolean) => void
  tickElapsed:         () => void
  setIsRecording:      (v: boolean) => void
  setAiLoading:        (section: string, loading: boolean) => void
  setTimelineExpanded: (v: boolean) => void
  setNextActions:      (actions: string[]) => void
  resetActiveSession:  () => void
}

// ─── 初期値 ──────────────────────────────────────────────────────────────────

const INIT_SESSION: NewSheetActiveSession = {
  servicePhase: 'aftercare',
  timePressure: false,
  elapsedSec:   0,
}
const INIT_NEXT: NextActionState = {
  actions: [], loading: false, generated: false,
}

// ─── デバッグログ ─────────────────────────────────────────────────────────────

function dbg(label: string, data?: unknown) {
  if (process.env.NODE_ENV !== 'development') return
  if (data !== undefined) {
    console.group(`[NewSheet] ${label}`)
    console.log(data)
    console.groupEnd()
  } else {
    console.log(`[NewSheet] ${label}`)
  }
}

// ─── Body scroll lock ────────────────────────────────────────────────────────

function lockScroll() {
  if (typeof document === 'undefined') return
  document.body.style.overflow = 'hidden'
  // iOS Safari: position fixed で背景スクロール防止
  document.body.style.position = 'fixed'
  document.body.style.width    = '100%'
}
function unlockScroll() {
  if (typeof document === 'undefined') return
  document.body.style.overflow = ''
  document.body.style.position = ''
  document.body.style.width    = ''
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useNewCustomerSheetStore = create<NewSheetState>((set, get) => ({
  isOpen:            false,
  customer:          null,
  reservation:       null,
  activeSession:     INIT_SESSION,
  isRecording:       false,
  aiLoadingSections: new Set(),
  timelineExpanded:  false,
  nextActionState:   INIT_NEXT,

  open: (customer, reservation) => {
    dbg('open', { name: customer.name, menu: reservation.menu })
    lockScroll()
    set({
      isOpen: true, customer, reservation,
      activeSession: INIT_SESSION,
      isRecording: false,
      aiLoadingSections: new Set(),
      timelineExpanded: false,
      nextActionState: INIT_NEXT,
    })
  },

  close: () => {
    dbg('close', { prevCustomer: get().customer?.name })
    unlockScroll()
    set({
      isOpen: false, customer: null, reservation: null,
      activeSession: INIT_SESSION,
      isRecording: false,
      aiLoadingSections: new Set(),
      timelineExpanded: false,
      nextActionState: INIT_NEXT,
    })
  },

  setServicePhase: (phase) => {
    dbg('setServicePhase', phase)
    set(s => ({ activeSession: { ...s.activeSession, servicePhase: phase } }))
  },

  setTimePressure: (v) => {
    set(s => ({ activeSession: { ...s.activeSession, timePressure: v } }))
  },

  tickElapsed: () => {
    set(s => ({
      activeSession: {
        ...s.activeSession,
        elapsedSec: s.activeSession.elapsedSec + 60,
      },
    }))
  },

  setIsRecording: (v) => {
    dbg(v ? 'recording start' : 'recording stop')
    set(s => ({
      isRecording:   v,
      activeSession: { ...s.activeSession, timePressure: v },
    }))
  },

  setAiLoading: (section, loading) => {
    dbg(`AI loading: ${section}`, loading)
    set(s => {
      const next = new Set(s.aiLoadingSections)
      loading ? next.add(section) : next.delete(section)
      return { aiLoadingSections: next }
    })
  },

  setTimelineExpanded: (v) => {
    dbg('timelineExpanded', v)
    set({ timelineExpanded: v })
  },

  setNextActions: (actions) => {
    set({ nextActionState: { actions, loading: false, generated: true } })
  },

  resetActiveSession: () => {
    dbg('resetActiveSession')
    set({
      activeSession:   INIT_SESSION,
      isRecording:     false,
      aiLoadingSections: new Set(),
      timelineExpanded: false,
      nextActionState: INIT_NEXT,
    })
  },
}))
