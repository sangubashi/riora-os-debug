'use client'
/**
 * ホーム画面追加の案内(PWAインストール導線)。
 * 「押し売りしない」方針: 初回訪問では出さない・today画面表示直後に1回だけ・
 * [あとで]で7日間非表示・3回無視で恒久非表示。既にインストール済み(standalone)なら常に非表示。
 * 参照: docs/Riora_PWA化最終設計_v1.0.md 「インストール導線」節
 */
import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Smartphone, Share, X } from 'lucide-react'
import { useAuthStore } from '@/store/useAuthStore'

const VISIT_KEY           = 'riora_pwa_visit_count'
const SESSION_COUNTED_KEY = 'riora_pwa_visit_counted_session'
const DISMISS_COUNT_KEY   = 'riora_pwa_install_dismiss_count'
const DISMISS_UNTIL_KEY   = 'riora_pwa_install_dismiss_until'
const DISMISS_SUPPRESS_DAYS  = 7
const DISMISS_MAX_COUNT      = 3
const MIN_VISIT_COUNT_TO_SHOW = 2

type Platform = 'ios' | 'android' | 'other'

function detectPlatform(): Platform {
  const ua = navigator.userAgent
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios'
  if (/android/i.test(ua)) return 'android'
  return 'other'
}

function isStandalone() {
  const nav = navigator as Navigator & { standalone?: boolean }
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true
}

// LINE/Instagram/Facebook等の代表的なアプリ内ブラウザ(iOSでは共有メニューに
// 「ホーム画面に追加」が出ないため、Safariで開き直すよう案内する)
function isInAppBrowser() {
  return /Line\/|FBAN|FBAV|Instagram/i.test(navigator.userAgent)
}

export default function InstallPrompt() {
  const session     = useAuthStore(s => s.session)
  const initialized = useAuthStore(s => s.initialized)

  const [visible, setVisible]             = useState(false)
  const [platform, setPlatform]           = useState<Platform>('other')
  const [inAppBrowser, setInAppBrowser]   = useState(false)
  const [canInstallAndroid, setCanInstallAndroid] = useState(false)
  const deferredPromptRef = useRef<BeforeInstallPromptLikeEvent | null>(null)

  // Android: beforeinstallpromptを保留(自動ダイアログを止めて、こちらのタイミングで出す)
  useEffect(() => {
    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault()
      deferredPromptRef.current = e as BeforeInstallPromptLikeEvent
      setCanInstallAndroid(true)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
  }, [])

  // 訪問回数のカウント(ブラウザタブのセッションごとに1回だけ加算)
  useEffect(() => {
    if (sessionStorage.getItem(SESSION_COUNTED_KEY)) return
    sessionStorage.setItem(SESSION_COUNTED_KEY, '1')
    const current = Number(localStorage.getItem(VISIT_KEY) || '0')
    localStorage.setItem(VISIT_KEY, String(current + 1))
  }, [])

  // 表示条件の判定: ログイン済み・2回目以降訪問・恒久/期間非表示でない・
  // インストール済みでない・iOS/Androidのみ
  useEffect(() => {
    if (!initialized || !session) return
    if (isStandalone()) return

    const p = detectPlatform()
    if (p === 'other') return

    const visitCount = Number(localStorage.getItem(VISIT_KEY) || '0')
    if (visitCount < MIN_VISIT_COUNT_TO_SHOW) return

    const dismissCount = Number(localStorage.getItem(DISMISS_COUNT_KEY) || '0')
    if (dismissCount >= DISMISS_MAX_COUNT) return

    const dismissedUntil = Number(localStorage.getItem(DISMISS_UNTIL_KEY) || '0')
    if (Date.now() < dismissedUntil) return

    setPlatform(p)
    setInAppBrowser(isInAppBrowser())
    // today画面表示直後、落ち着いてから控えめに出す
    const timer = setTimeout(() => setVisible(true), 900)
    return () => clearTimeout(timer)
  }, [initialized, session])

  function handleLater() {
    const count = Number(localStorage.getItem(DISMISS_COUNT_KEY) || '0') + 1
    localStorage.setItem(DISMISS_COUNT_KEY, String(count))
    localStorage.setItem(DISMISS_UNTIL_KEY, String(Date.now() + DISMISS_SUPPRESS_DAYS * 24 * 60 * 60 * 1000))
    setVisible(false)
  }

  async function handleInstallAndroid() {
    const promptEvent = deferredPromptRef.current
    if (!promptEvent) return
    promptEvent.prompt()
    try { await promptEvent.userChoice } catch { /* ユーザーが選択せず閉じた場合等は無視 */ }
    deferredPromptRef.current = null
    setVisible(false)
  }

  // Androidはbeforeinstallpromptを実際に捕捉できた場合のみ表示(捕捉できなければ何も出さない)
  if (!visible) return null
  if (platform === 'android' && !canInstallAndroid) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        transition={{ duration: 0.3 }}
        className="mx-4 mb-3 rounded-2xl overflow-hidden"
        style={{
          background: 'rgba(255,255,255,0.92)',
          border: '1px solid #F5E6E8',
          boxShadow: '0 2px 10px rgba(245,160,181,0.10)',
        }}
      >
        <div className="flex items-start gap-3 px-4 py-3.5">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(245,110,139,0.12)' }}
          >
            <Smartphone size={18} style={{ color: '#F56E8B' }} strokeWidth={1.8} />
          </div>

          <div className="flex-1 min-w-0">
            {platform === 'ios' && inAppBrowser && (
              <>
                <p className="text-[13px] font-semibold" style={{ color: '#4A2C2A' }}>
                  この画面ではホーム画面に追加できません
                </p>
                <p className="text-[11px] mt-1" style={{ color: '#9E8090', lineHeight: '1.6' }}>
                  右上のメニューから「Safariで開く」を選んでから、あらためてお試しください。
                </p>
              </>
            )}

            {platform === 'ios' && !inAppBrowser && (
              <>
                <p className="text-[13px] font-semibold" style={{ color: '#4A2C2A' }}>
                  ホーム画面に追加できます
                </p>
                <p className="text-[11px] mt-1" style={{ color: '#9E8090', lineHeight: '1.6' }}>
                  追加するとアイコンからすぐに開けます。
                </p>
                <div className="flex items-center gap-1.5 mt-2 text-[11px]" style={{ color: '#6B4C4C' }}>
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full" style={{ background: '#F5E6E8' }}>
                    <Share size={11} style={{ color: '#D98292' }} />
                  </span>
                  <span>共有ボタン →「ホーム画面に追加」をタップ</span>
                </div>
              </>
            )}

            {platform === 'android' && (
              <>
                <p className="text-[13px] font-semibold" style={{ color: '#4A2C2A' }}>
                  ホーム画面に追加しませんか？
                </p>
                <p className="text-[11px] mt-1" style={{ color: '#9E8090', lineHeight: '1.6' }}>
                  追加するとアイコンからすぐに開けます。
                </p>
              </>
            )}

            <div className="flex items-center gap-3 mt-2.5">
              {platform === 'android' && (
                <button
                  onClick={handleInstallAndroid}
                  className="text-[12px] font-semibold rounded-full px-3.5 py-1.5"
                  style={{ background: '#F56E8B', color: '#FFFFFF' }}
                >
                  追加する
                </button>
              )}
              <button
                onClick={handleLater}
                className="text-[12px]"
                style={{ color: '#9E8090' }}
              >
                あとで
              </button>
            </div>
          </div>

          <button
            onClick={handleLater}
            aria-label="閉じる"
            className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
          >
            <X size={14} style={{ color: '#C8A8B0' }} />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}

// Chromeのbeforeinstallpromptは標準libに型定義が無いため最小限の形だけ宣言
interface BeforeInstallPromptLikeEvent extends Event {
  prompt: () => void
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}
