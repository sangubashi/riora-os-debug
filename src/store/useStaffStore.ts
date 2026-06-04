/**
 * useStaffStore  –  スタッフ画面グローバル状態
 *
 * selectedCustomer は src/types/index.ts の Customer型（フロント表示用）を使用。
 * CustomerBottomSheet が参照するフィールドを全て含む。
 */
import { create } from 'zustand'
import type { Reservation, Customer, AiSuggestion, ServicePhase } from '@/types'

type StaffRole = 'owner' | 'admin' | 'staff' | null

/** 接客セッション状態（SINGLE SOURCE OF TRUTH） */
export interface ActiveSessionState {
  servicePhase:  ServicePhase
  timePressure:  boolean
}

type StaffStore = {
  todayReservations:   Reservation[]
  selectedReservation: Reservation | null
  selectedCustomer:    Customer | null
  aiSuggestion:        AiSuggestion | null
  currentStaffId:      string | null
  userRole:            StaffRole
  /** STEP1: activeSession を Single Source of Truth に統一 */
  activeSession:       ActiveSessionState

  setCurrentStaffId:      (id: string) => void
  setSelectedReservation: (reservation: Reservation | null) => void
  setSelectedCustomer:    (customer: Customer | null) => void
  setTodayReservations:   (reservations: Reservation[]) => void
  setAiSuggestion:        (suggestion: AiSuggestion | null) => void
  setUserRole:            (role: StaffRole) => void
  setServicePhase:        (phase: ServicePhase) => void
  setTimePressure:        (pressure: boolean) => void
  resetActiveSession:     () => void
}

export const useStaffStore = create<StaffStore>((set) => ({
  todayReservations:   [],
  selectedReservation: null,
  selectedCustomer:    null,
  aiSuggestion:        null,
  currentStaffId:      null,
  userRole:            null,
  activeSession:       { servicePhase: 'aftercare', timePressure: false },

  setCurrentStaffId:      (id)           => set({ currentStaffId: id }),
  setSelectedReservation: (reservation)  => set({ selectedReservation: reservation }),
  setSelectedCustomer:    (customer)     => set({ selectedCustomer: customer }),
  setTodayReservations:   (reservations) => set({ todayReservations: reservations }),
  setAiSuggestion:        (suggestion)   => set({ aiSuggestion: suggestion }),
  setUserRole:            (role)         => set({ userRole: role }),
  setServicePhase:   (phase)    => set(s => ({ activeSession: { ...s.activeSession, servicePhase: phase } })),
  setTimePressure:   (pressure) => set(s => ({ activeSession: { ...s.activeSession, timePressure: pressure } })),
  resetActiveSession: ()        => set({ activeSession: { servicePhase: 'aftercare', timePressure: false } }),
}))
