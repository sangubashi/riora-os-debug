'use client'
/**
 * CustomerTopPage.tsx — 顧客トップページ(2026-09-24ユーザー承認)。
 *
 * 「本日の予約」「顧客タブ検索結果」でお客様名をタップした際の新しい遷移先。
 *
 * 「接客ログ / AI Timeline」ボタン(CustomerBottomSheetへの導線)は2026-09-24
 * ユーザー承認により削除した。CustomerBottomSheet自体は無改修のまま(呼び出し元が
 * このファイルから無くなっただけ)。
 *
 * 基本情報について(2026-09-24ユーザー承認・PII方針の例外化): 現場スタッフ運用の
 * 要望により、brain_customers.birth_date列を新設し、生年月日・年齢を正確に表示する
 * (以前はage_group「年代」のみの表示だったが、これに置き換えた)。生年月日が未登録の
 * 顧客は「未設定」と表示する。年齢は満年齢(誕生日を迎えていなければ1引く)で算出する。
 * 電話・メール・住所等、生年月日以外のPII除外方針は変更していない。
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { X, ChevronRight, Camera } from 'lucide-react'
import { authedFetch } from '@/lib/api/authedFetch'
import { PALETTE, headingFont } from '@/components/customer/shared/PhotoCompareKit'
import InitialQuestionnaireCaptureModal from '@/components/customer/ipadKarte/InitialQuestionnaireCaptureModal'
import type { Customer, Reservation } from '@/types'

interface Props {
  customer:     Customer
  reservation?: Reservation
  onClose:      () => void
}

interface QuestionnaireState {
  path:       string | null
  url:        string | null
  uploadedAt: string | null
}

interface CustomerDetailResponse {
  success:  boolean
  customer?: { birthDate?: string | null }
}

/** 満年齢を計算する(誕生日を迎えていなければ1引く)。 */
function calculateAge(birthDate: string): number | null {
  const m = birthDate.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const [, y, mo, d] = m
  const birth = new Date(Number(y), Number(mo) - 1, Number(d))
  if (Number.isNaN(birth.getTime())) return null

  const now = new Date()
  let age = now.getFullYear() - birth.getFullYear()
  const hasHadBirthdayThisYear =
    now.getMonth() > birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() >= birth.getDate())
  if (!hasHadBirthdayThisYear) age -= 1
  return age
}

/** "YYYY-MM-DD" → "1987年5月22日"。 */
function formatBirthDateJapanese(birthDate: string): string | null {
  const m = birthDate.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const [, y, mo, d] = m
  return `${y}年${Number(mo)}月${Number(d)}日`
}

interface QuestionnaireResponse {
  success:  boolean
  path?:    string | null
  url?:     string | null
  uploadedAt?: string | null
}

export default function CustomerTopPage({ customer, reservation, onClose }: Props) {
  const router = useRouter()
  const [birthDate, setBirthDate] = useState<string | null>(null)
  const [questionnaire, setQuestionnaire] = useState<QuestionnaireState | null>(null)
  const [questionnaireLoading, setQuestionnaireLoading] = useState(true)
  const [showEnlarged, setShowEnlarged]     = useState(false)
  const [showCaptureModal, setShowCaptureModal] = useState(false)

  const fetchQuestionnaire = useCallback(async () => {
    setQuestionnaireLoading(true)
    try {
      const res = await authedFetch(`/api/customers/${customer.id}/initial-questionnaire`)
      if (res.ok) {
        const json = await res.json() as QuestionnaireResponse
        setQuestionnaire({
          path:       json.path ?? null,
          url:        json.url ?? null,
          uploadedAt: json.uploadedAt ?? null,
        })
      }
    } catch {
      /* 取得失敗時は「未登録」相当の表示のまま(致命的にしない) */
    } finally {
      setQuestionnaireLoading(false)
    }
  }, [customer.id])

  useEffect(() => { void fetchQuestionnaire() }, [fetchQuestionnaire])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await authedFetch(`/api/customers/${customer.id}`)
        if (res.ok) {
          const json = await res.json() as CustomerDetailResponse
          if (!cancelled) setBirthDate(json.customer?.birthDate ?? null)
        }
      } catch {
        /* 取得失敗時は生年月日欄を空のまま(致命的にしない) */
      }
    })()
    return () => { cancelled = true }
  }, [customer.id])

  const goToDetailPage = () => router.push(`/karte/${customer.id}`)

  const cardStyle: React.CSSProperties = {
    borderRadius: '16px', border: `1px solid ${PALETTE.border}`, padding: '20px',
    display: 'flex', flexDirection: 'column', gap: '14px',
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: PALETTE.bg, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
      <div
        style={{
          flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: 'max(14px, calc(env(safe-area-inset-top) + 10px)) 20px 12px', borderBottom: `1px solid ${PALETTE.border}`,
        }}
      >
        <p style={{ margin: 0, fontSize: '12px', color: PALETTE.gold, letterSpacing: '0.08em', fontFamily: headingFont.style.fontFamily }}>
          KARTE TOP
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="閉じる"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px', color: PALETTE.muted }}
        >
          <X size={22} />
        </button>
      </div>

      <div style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '640px', width: '100%', margin: '0 auto' }}>
        {/* 基本情報 */}
        <div style={cardStyle}>
          <p style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: PALETTE.text, fontFamily: headingFont.style.fontFamily }}>
            {customer.name} 様
          </p>
          <p style={{ margin: 0, fontSize: '13px', color: PALETTE.muted }}>
            {(() => {
              if (!birthDate) return '生年月日: 未設定'
              const formatted = formatBirthDateJapanese(birthDate)
              const age = calculateAge(birthDate)
              if (!formatted || age === null) return '生年月日: 未設定'
              return `${formatted}（${age}歳）`
            })()}
          </p>
        </div>

        {/* 初回問診票 */}
        <div style={cardStyle}>
          <p style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: PALETTE.text, fontFamily: headingFont.style.fontFamily }}>
            初回問診票
          </p>

          {questionnaireLoading ? (
            <p style={{ margin: 0, fontSize: '13px', color: PALETTE.muted }}>読み込み中…</p>
          ) : questionnaire?.url ? (
            <button
              type="button"
              onClick={() => setShowEnlarged(true)}
              style={{ padding: 0, border: `1px solid ${PALETTE.border}`, borderRadius: '10px', overflow: 'hidden', cursor: 'pointer', background: 'none', width: '160px' }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- signed URL(署名付き一時URL)のためnext/imageの永続キャッシュ最適化とは相性が悪く不要 */}
              <img src={questionnaire.url} alt="初回問診票サムネイル" style={{ width: '100%', aspectRatio: '3 / 4', objectFit: 'cover', display: 'block' }} />
            </button>
          ) : (
            <p style={{ margin: 0, fontSize: '13px', color: PALETTE.muted }}>初回問診票は未登録</p>
          )}

          <button
            type="button"
            onClick={() => setShowCaptureModal(true)}
            style={{
              alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '6px',
              padding: '9px 16px', borderRadius: '999px', border: `1.5px solid ${PALETTE.gold}`,
              background: 'none', color: PALETTE.gold, fontSize: '13px', fontWeight: 700, cursor: 'pointer',
            }}
          >
            <Camera size={16} /> {questionnaire?.url ? '撮り直す・差し替える' : '撮影・登録する'}
          </button>
        </div>

        {/* 詳細ページ導線 */}
        <button
          type="button"
          onClick={goToDetailPage}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            padding: '16px 20px', borderRadius: '14px', border: 'none',
            background: PALETTE.gold, color: '#fff', fontSize: '15px', fontWeight: 700, cursor: 'pointer',
            fontFamily: headingFont.style.fontFamily,
          }}
        >
          詳細ページを見る <ChevronRight size={18} />
        </button>
      </div>

      {showEnlarged && questionnaire?.url && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}
          onClick={() => setShowEnlarged(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- 拡大表示のみでnext/imageの最適化は不要 */}
          <img
            src={questionnaire.url}
            alt="初回問診票"
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: '8px' }}
            onClick={e => e.stopPropagation()}
          />
          <button
            type="button"
            onClick={() => setShowEnlarged(false)}
            aria-label="閉じる"
            style={{
              position: 'absolute', top: 'max(16px, env(safe-area-inset-top))', right: '16px',
              background: 'rgba(255,255,255,0.9)', border: 'none', borderRadius: '50%',
              width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            }}
          >
            <X size={20} />
          </button>
        </div>
      )}

      {showCaptureModal && (
        <InitialQuestionnaireCaptureModal
          customerId={customer.id}
          onClose={() => setShowCaptureModal(false)}
          onSaved={() => { setShowCaptureModal(false); void fetchQuestionnaire() }}
        />
      )}
    </div>
  )
}
