/**
 * useAuthStore  –  Salon Riora OS 認証ストア
 *
 * ① サインアップ前に check_signup_allowed() RPC でメール検証
 * ② サインイン / サインアウト
 * ③ 招待管理（オーナー用）
 * ④ ログインセッション永続化
 *
 * セキュリティ設計:
 *   ・未招待メールはサインアップ拒否（DB Trigger + クライアント双方でガード）
 *   ・JWT の role クレームで is_owner() を判定
 *   ・useDashboardStore と連携しセッション状態を同期
 */
import { create } from 'zustand'
import { supabase, DEMO_MODE } from '@/lib/supabase'
import type { User, Session } from '@supabase/supabase-js'
import type { UserRole } from './useDashboardStore'

// ─── 型定義 ──────────────────────────────────────────────────────────────────

export interface StaffInvitation {
  id:          string
  email:       string
  role:        UserRole
  invited_by:  string | null
  note:        string | null
  used_at:     string | null
  expires_at:  string | null
  is_active:   boolean
  created_at:  string
}

export interface AuthState {
  user:         User | null
  session:      Session | null
  isLoading:    boolean
  initialized:  boolean   // initialize() 完了フラグ
  error:        string | null

  // セッション初期化
  initialize:   () => Promise<void>

  // サインアップ（招待確認 → Supabase signUp）
  signUp: (params: {
    email:     string
    password:  string
    fullName?: string
  }) => Promise<{ success: boolean; error?: string }>

  // サインイン
  signIn: (params: {
    email:    string
    password: string
  }) => Promise<{ success: boolean; error?: string }>

  // サインアウト
  signOut: () => Promise<void>

  // パスワードリセット
  resetPassword: (email: string) => Promise<{ success: boolean; error?: string }>

  // 招待管理（オーナー専用）
  inviteStaff: (params: {
    email: string
    role:  'staff' | 'admin'
    note?: string
  }) => Promise<{ success: boolean; error?: string }>

  fetchInvitations: () => Promise<StaffInvitation[]>
  revokeInvitation: (id: string) => Promise<void>
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useAuthStore = create<AuthState>((set, get) => ({
  user:        null,
  session:     null,
  isLoading:   false,
  initialized: false,
  error:       null,

  // ── セッション初期化 ─────────────────────────────────────────────────────────
  initialize: async () => {
    if (get().initialized) return
    if (DEMO_MODE) { set({ initialized: true, isLoading: false }); return }

    set({ isLoading: true })

    // Safari ITP 対策: getSession() が永久ハングしないよう 4秒でタイムアウト
    const sessionPromise = supabase.auth.getSession()
      .then(({ data }) => data.session)
      .catch(() => null)

    const timeoutPromise = new Promise<null>(resolve =>
      setTimeout(() => resolve(null), 4000)
    )

    try {
      const session = await Promise.race([sessionPromise, timeoutPromise])
      set({ session, user: session?.user ?? null })

      // onAuthStateChange は一度だけ登録（重複防止）
      supabase.auth.onAuthStateChange((_event, newSession) => {
        set({ session: newSession, user: newSession?.user ?? null })
      })
    } catch (e) {
      // エラーが起きても initialized を true にして画面を進める
      // （ログイン画面で再試行できる）
      console.warn('[AuthStore] initialize error (Safari ITP?):', e)
    } finally {
      // ここが必ず実行されることを保証
      set({ isLoading: false, initialized: true })
    }
  },

  // ── サインアップ ─────────────────────────────────────────────────────────────
  signUp: async ({ email, password, fullName }) => {
    set({ isLoading: true, error: null })
    try {
      // ① クライアント側での事前チェック（DB Trigger とは独立したダブルガード）
      const { data: checkData, error: checkError } = await supabase
        .rpc('check_signup_allowed', { p_email: email.toLowerCase().trim() })

      if (checkError) {
        return { success: false, error: '招待確認中にエラーが発生しました。' }
      }

      const check = checkData as { allowed: boolean; reason?: string; role?: string }
      if (!check.allowed) {
        return { success: false, error: check.reason ?? 'このメールアドレスでのサインアップは許可されていません。' }
      }

      // ② Supabase 認証でアカウント作成
      const { data, error } = await supabase.auth.signUp({
        email:    email.toLowerCase().trim(),
        password,
        options: {
          data: {
            full_name: fullName ?? '',
            role:      check.role ?? 'staff',
          },
        },
      })

      if (error) return { success: false, error: error.message }
      if (!data.user) return { success: false, error: 'アカウント作成に失敗しました。' }

      set({ user: data.user, session: data.session })
      return { success: true }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '予期せぬエラーが発生しました。'
      set({ error: msg })
      return { success: false, error: msg }
    } finally {
      set({ isLoading: false })
    }
  },

  // ── サインイン ───────────────────────────────────────────────────────────────
  signIn: async ({ email, password }) => {
    set({ isLoading: true, error: null })
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email:    email.toLowerCase().trim(),
        password,
      })

      if (error) {
        const msg = error.message === 'Invalid login credentials'
          ? 'メールアドレスまたはパスワードが正しくありません。'
          : error.message
        set({ error: msg })
        return { success: false, error: msg }
      }

      // initialized も true にセット（initialize() が先に呼ばれていない場合の保険）
      set({ user: data.user, session: data.session, initialized: true })
      return { success: true }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'ログインに失敗しました。'
      set({ error: msg })
      return { success: false, error: msg }
    } finally {
      set({ isLoading: false })
    }
  },

  // ── サインアウト ─────────────────────────────────────────────────────────────
  signOut: async () => {
    set({ isLoading: true })
    try {
      await supabase.auth.signOut()
      set({ user: null, session: null })
    } finally {
      set({ isLoading: false })
    }
  },

  // ── パスワードリセット ────────────────────────────────────────────────────────
  resetPassword: async (email) => {
    set({ isLoading: true, error: null })
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(
        email.toLowerCase().trim(),
        { redirectTo: `${typeof window !== 'undefined' ? window.location.origin : ''}/reset-password` }
      )
      if (error) return { success: false, error: error.message }
      return { success: true }
    } finally {
      set({ isLoading: false })
    }
  },

  // ── 招待管理（オーナー専用） ──────────────────────────────────────────────────
  inviteStaff: async ({ email, role, note }) => {
    set({ isLoading: true, error: null })
    try {
      const { error } = await supabase
        .from('staff_invitations')
        .insert({
          email:      email.toLowerCase().trim(),
          role,
          note:       note ?? null,
          is_active:  true,
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        })

      if (error) return { success: false, error: error.message }
      return { success: true }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '招待の送信に失敗しました。'
      return { success: false, error: msg }
    } finally {
      set({ isLoading: false })
    }
  },

  fetchInvitations: async () => {
    const { data, error } = await supabase
      .from('staff_invitations')
      .select('*')
      .order('created_at', { ascending: false })

    if (error || !data) return []
    return data as StaffInvitation[]
  },

  revokeInvitation: async (id) => {
    await supabase
      .from('staff_invitations')
      .update({ is_active: false })
      .eq('id', id)
  },
}))
