'use client'
/**
 * ChangePasswordSheet — My Page「パスワード変更」BottomSheet
 *
 * Supabase Authの標準的な方法のみを使用する(新規APIルート・DB変更は一切なし):
 *   ① supabase.auth.signInWithPassword() で現在のパスワードを再認証
 *   ② 成功後 supabase.auth.updateUser({ password }) でパスワード変更
 *
 * 既存のuseAuthStore.signIn()やapp/login/page.tsxの認証フローは呼び出さず、
 * 直接supabaseクライアントを叩くだけの独立した機能のため、既存ログインには
 * 一切手を加えていない。
 */
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/useAuthStore'

interface Props {
  isOpen:  boolean
  onClose: () => void
}

const MIN_LENGTH = 8

interface FormErrors {
  current?: string
  next?:    string
  confirm?: string
}

function PasswordField({
  label, value, onChange, error, autoComplete,
}: {
  label:        string
  value:        string
  onChange:     (v: string) => void
  error?:       string
  autoComplete: string
}) {
  return (
    <div>
      <label className="text-[12px] font-medium block mb-1.5" style={{ color: '#5C4033' }}>{label}</label>
      <div
        className="rounded-[14px] px-3.5"
        style={{ background: '#FFFFFF', border: `1px solid ${error ? '#D14F4F' : '#F5E6E8'}` }}
      >
        <input
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          className="w-full bg-transparent outline-none py-2.5"
          style={{ fontSize: 16, color: '#4A2C2A' }}
        />
      </div>
      {error && <p className="text-[11px] mt-1" style={{ color: '#D14F4F' }}>{error}</p>}
    </div>
  )
}

export default function ChangePasswordSheet({ isOpen, onClose }: Props) {
  const email = useAuthStore((s) => s.session?.user?.email ?? null)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword,     setNewPassword]     = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errors,          setErrors]          = useState<FormErrors>({})
  const [submitting,      setSubmitting]      = useState(false)

  function resetAndClose() {
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setErrors({})
    setSubmitting(false)
    onClose()
  }

  function validate(): boolean {
    const next: FormErrors = {}
    if (!currentPassword) next.current = '現在のパスワードを入力してください'
    if (!newPassword) {
      next.next = '新しいパスワードを入力してください'
    } else if (newPassword.length < MIN_LENGTH) {
      next.next = `${MIN_LENGTH}文字以上で入力してください`
    }
    if (!confirmPassword) {
      next.confirm = '確認用のパスワードを入力してください'
    } else if (newPassword && confirmPassword !== newPassword) {
      next.confirm = 'パスワードが一致しません'
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function handleSubmit() {
    if (submitting) return
    if (!validate()) return

    if (!email) {
      setErrors({ current: 'アカウント情報を確認できませんでした' })
      return
    }

    setSubmitting(true)
    try {
      // ① 現在のパスワードを再認証(Supabase Authの標準的な方法)
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email,
        password: currentPassword,
      })
      if (reauthError) {
        setErrors({ current: '現在のパスワードが正しくありません' })
        setSubmitting(false)
        return
      }

      // ② 認証成功後にパスワード変更
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
      if (updateError) {
        setErrors({ next: updateError.message || 'パスワードの変更に失敗しました' })
        setSubmitting(false)
        return
      }

      // ③ 成功
      toast.success('パスワードを変更しました')
      resetAndClose()
    } catch {
      setErrors({ next: 'パスワードの変更に失敗しました。時間をおいて再度お試しください' })
      setSubmitting(false)
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            key="changepw-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={submitting ? undefined : resetAndClose}
            className="fixed inset-0 z-40"
            style={{ background: 'rgba(74,44,42,0.22)', backdropFilter: 'blur(6px)' }}
          />

          <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center pointer-events-none">
            <motion.div
              key="changepw-sheet"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 32, stiffness: 300 }}
              className="w-full max-w-[430px] pointer-events-auto rounded-t-[32px] flex flex-col"
              style={{
                maxHeight: '86dvh',
                background: 'rgba(255,255,255,0.97)',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                boxShadow: '0 -4px 32px rgba(245,160,181,0.16), 0 -2px 8px rgba(74,44,42,0.06)',
                border: '1px solid rgba(255,255,255,0.9)',
                borderBottom: 'none',
              }}
            >
              <div className="flex justify-center pt-3.5 pb-1 flex-shrink-0">
                <div className="w-10 h-1 rounded-full bg-[#F5E6E8]" />
              </div>

              <div className="flex items-center justify-between px-5 py-3 border-b border-[#F5E6E8] flex-shrink-0">
                <h3 className="text-[15px] font-semibold text-salon-brown">パスワード変更</h3>
                <button
                  onClick={resetAndClose}
                  disabled={submitting}
                  className="w-7 h-7 rounded-full bg-[#F8F1F3] flex items-center justify-center"
                >
                  <X size={13} className="text-salon-brown-sub" />
                </button>
              </div>

              <div
                className="flex-1 overflow-y-auto no-scrollbar px-5 py-4"
                style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
              >
                <div className="flex flex-col gap-4">
                  <PasswordField
                    label="現在のパスワード"
                    value={currentPassword}
                    onChange={setCurrentPassword}
                    error={errors.current}
                    autoComplete="current-password"
                  />
                  <PasswordField
                    label="新しいパスワード"
                    value={newPassword}
                    onChange={setNewPassword}
                    error={errors.next}
                    autoComplete="new-password"
                  />
                  <PasswordField
                    label="新しいパスワード（確認）"
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    error={errors.confirm}
                    autoComplete="new-password"
                  />
                </div>
              </div>

              <div
                className="flex-shrink-0 px-5 pt-3 flex flex-col gap-2"
                style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))', background: 'rgba(255,255,255,0.98)' }}
              >
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="w-full py-3.5 rounded-full text-white text-[14px] font-semibold flex items-center justify-center gap-2"
                  style={{
                    background: 'linear-gradient(135deg, #5A3840, #4A2C2A)',
                    boxShadow: '0 4px 14px rgba(74,44,42,0.30)',
                    opacity: submitting ? 0.7 : 1,
                  }}
                >
                  {submitting ? '変更中…' : '変更する'}
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={resetAndClose}
                  disabled={submitting}
                  className="w-full py-3 rounded-full text-[13px] font-semibold"
                  style={{ color: '#9F7E6C', background: 'transparent' }}
                >
                  キャンセル
                </motion.button>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  )
}
