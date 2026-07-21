/**
 * detectVisitReminders.ts — 🔔来店リマインド検出ロジック(純粋関数・DB非依存)
 *
 * Riora_アプリ内通知v1_祝福気遣いカード_設計書_v1.0.md §3-4 準拠。
 * 「次回来店予定の前日〜当日」に、担当スタッフ本人へ禁忌・重要メモ・直近の
 * 会話メモを添えて通知する。今日タブの3行ブリーフィングと同じ情報源
 * (contraindications・customer_memories)を使い、内容の整合を取っている。
 *
 * 表示順序(§3-4のC案通り):
 *   ① 禁忌情報(必ず表示・安全のため省略しない)
 *   ② 重要フラグ付きメモ(customer_memories.importance='high'、非センシティブのみ)
 *   ③ 直近の会話メモ(最大2件、①②と重複しないもの)
 */
import type { StaffNotification } from '@/types/notifications'

const SEVERITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }
const RECENT_MEMORY_LIMIT = 2

export interface VisitReminderContraindication {
  severity:    string
  title:       string
  description: string | null
}

export interface VisitReminderInput {
  reservationId:      string
  customerId:         string // brain_customers.id
  customerName:        string
  scheduledAt:         string // ISO
  createdAt:           string // reservations.created_at。同一customer_id×同一scheduled_atの重複行から最古を選ぶ際に使う
  lastVisitDate:       string | null // 直近の過去来店日(未来予約の前提のため「その予約より前の最終来店」とみなせる)
  contraindications:   VisitReminderContraindication[]
  importantMemories:   string[] // content。importance='high' かつ is_sensitive=false のみ
  recentMemories:      string[] // content。非センシティブ、created_at降順
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function daysSinceLastVisit(scheduledAt: string, lastVisitDate: string | null): number | null {
  if (!lastVisitDate) return null
  const diff = startOfDay(new Date(scheduledAt)).getTime() - startOfDay(new Date(lastVisitDate)).getTime()
  return Math.round(diff / 86_400_000)
}

/** 予約日が「今日」「明日」のいずれでもなければnull(前日〜当日のみを対象とする§3-4の要件)。 */
function relativeDayLabel(scheduledAt: string, today: Date): '本日' | '明日' | null {
  const base = startOfDay(today).getTime()
  const target = startOfDay(new Date(scheduledAt)).getTime()
  const diffDays = Math.round((target - base) / 86_400_000)
  if (diffDays === 0) return '本日'
  if (diffDays === 1) return '明日'
  return null
}

/** 予約1件分から来店リマインド通知を組み立てる(純粋関数)。前日〜当日以外はnull。 */
export function buildVisitReminder(input: VisitReminderInput, today: Date = new Date()): StaffNotification | null {
  const dayLabel = relativeDayLabel(input.scheduledAt, today)
  if (!dayLabel) return null

  const days = daysSinceLastVisit(input.scheduledAt, input.lastVisitDate)
  const visitPhrase = days === null ? '初めてのご来店' : `${days}日ぶりのご来店`

  const detail: string[] = []

  // ① 禁忌情報 — 必ず表示(安全のため省略しない)
  input.contraindications
    .slice()
    .sort((a, b) =>
      (SEVERITY_ORDER[String(a.severity).toUpperCase()] ?? 9) -
      (SEVERITY_ORDER[String(b.severity).toUpperCase()] ?? 9))
    .forEach((c) => {
      detail.push(`⚠ ${c.description ? `${c.title}：${c.description}` : c.title}（禁忌）`)
    })

  // ② 重要フラグ付きメモ
  input.importantMemories.forEach((m) => detail.push(`・${m}`))

  // ③ 直近の会話メモ(①②と重複しないもの、最大2件)
  const shown = new Set(input.importantMemories)
  input.recentMemories
    .filter((m) => !shown.has(m))
    .slice(0, RECENT_MEMORY_LIMIT)
    .forEach((m) => detail.push(`・${m}`))

  return {
    id: `visit_reminder:${input.customerId}:${input.reservationId}`,
    kind: 'visit_reminder',
    emoji: '🔔',
    title: `${dayLabel} ${input.customerName}様ご来店（${visitPhrase}）`,
    customerId: input.customerId,
    customerName: input.customerName,
    detail: detail.length > 0 ? detail : undefined,
  }
}

/**
 * 同一customer_id×同一scheduled_atのreservations行を1件に集約する(created_at最古を採用)。
 * reservation CSV再取込時の重複増殖(既知バグ。714db3bで新規発生は防止済みだが、それ以前に
 * 生成された既存の重複行は残存している)により、同一予約が複数のreservations行として
 * DBに存在するケースへの対策。scheduled_atが異なる予約(=正当な複数来店)は集約しない。
 */
function dedupeByCustomerAndSchedule(inputs: VisitReminderInput[]): VisitReminderInput[] {
  const byKey = new Map<string, VisitReminderInput>()
  for (const input of inputs) {
    const key = `${input.customerId}|${input.scheduledAt}`
    const existing = byKey.get(key)
    if (!existing || input.createdAt < existing.createdAt) {
      byKey.set(key, input)
    }
  }
  return Array.from(byKey.values())
}

/** 複数予約をまとめて処理する(通知一覧画面用)。 */
export function buildVisitReminders(
  inputs: VisitReminderInput[],
  today: Date = new Date()
): StaffNotification[] {
  const results: StaffNotification[] = []
  for (const input of dedupeByCustomerAndSchedule(inputs)) {
    const n = buildVisitReminder(input, today)
    if (n) results.push(n)
  }
  return results
}
