import { supabase, DEMO_MODE } from './supabase'
import type { UserRole, Profile } from '@/types/database'

export async function getMyProfile(): Promise<Profile | null> {
  if (DEMO_MODE) return null
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    const { data, error } = await supabase
      .from('profiles')
      .select('id, role, staff_name, display_name, created_at')
      .eq('id', user.id)
      .single()
    if (error || !data) return null
    return data as Profile
  } catch {
    return null
  }
}

export async function getMyRole(): Promise<UserRole | null> {
  if (DEMO_MODE) return 'staff'
  const profile = await getMyProfile()
  return profile?.role ?? null
}

export async function requireAuth(): Promise<string> {
  if (DEMO_MODE) return 'demo-user'
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) throw new Error('認証が必要です。')
  return user.id
}

export function isOwner(role: UserRole | null): boolean {
  return role === 'owner'
}
