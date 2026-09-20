'use client'
/**
 * staffTagApiClient.ts — 担当者タグ選択(PHASE IPAD-SHARED-LOGIN-1・2026-09-20ユーザー承認)用
 * の薄いAPIクライアント。GET /api/staff/active-listを呼ぶだけ。
 */
import { authedFetch } from '@/lib/api/authedFetch'

export interface ActiveStaffOption {
  id:   string
  name: string
}

interface ActiveStaffListResponse {
  success: boolean
  staff?:  ActiveStaffOption[]
}

export async function fetchActiveStaffList(): Promise<ActiveStaffOption[]> {
  const res = await authedFetch('/api/staff/active-list')
  if (!res.ok) return []
  const body = (await res.json()) as ActiveStaffListResponse
  if (!body.success || !body.staff) return []
  return body.staff
}
