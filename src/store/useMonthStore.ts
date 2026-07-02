/**
 * useMonthStore.ts — 管理ダッシュボード共通「表示月」状態
 *
 * YYYY-MM 形式で保持する。全ページ(経営TOP・スタッフ分析・KPI)が
 * このストアを参照し、同一月を集計対象にする。
 * URL パラム ?month=YYYY-MM での永続化は各ページコンポーネントが担当する。
 */
import { create } from 'zustand'

function currentYearMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

interface MonthState {
  selectedMonth: string
  setSelectedMonth: (month: string) => void
}

export const useMonthStore = create<MonthState>((set) => ({
  selectedMonth: currentYearMonth(),
  setSelectedMonth: (month) => set({ selectedMonth: month }),
}))
