'use client'
/**
 * CustomerTopPage.tsx — 顧客トップページ(2026-09-24ユーザー承認)。
 *
 * 「本日の予約」「顧客タブ検索結果」でお客様名をタップした際の新しい遷移先。
 * 従来ここで直接開いていたCustomerBottomSheetは置き換えず、このページ内の
 * 「接客ログ / AI Timeline」ボタンから同じprops(customer/reservation)でそのまま
 * 呼び出せるようにする(機能を失わないための導線、CustomerBottomSheet自体は無改修)。
 *
 * 基本情報について: 現行の brain_customers テーブルには生年月日(birth_date)列が
 * 存在せず、CSV取込(salonBoardParser.ts)ではむしろ生年月日をPII(個人情報)として
 * 意図的に除去する方針が既に取られている(piiSanitizer.ts)。そのため本画面では
 * 「生年月日・年齢」の代わりに、既存の age_group(年代、例:「30代」)のみを表示する。
 * 正確な生年月日・年齢を表示するには、このPII除去方針を見直した上でのスキーマ変更
 * (brain_customersへのbirth_date列追加)とデータ入力導線の新設が別途必要になるため、
 * 今回は実装していない(要ユーザー判断、詳細はCLAUDE.md追記を参照)。
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { X, ChevronRight, Camera } from 'lucide-react'
import { authedFetch } from '@/lib/api/authedFetch'
import { PALETTE, headingFont } from '@/components/customer/shared/PhotoCompareKit'
import CustomerBottomSheet from '@/components/customer/CustomerBottomSheet'
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
  customer?: { ageGroup?: string | null }
}

interface QuestionnaireResponse {
  success:  boolean
  path?:    string | null
  url?:     string | null
  uploadedAt?: string | null
}

export default function CustomerTopPage({ customer, reservation, onClose }: Props) {
  const router = useRouter()
  const [ageGroup, setAgeGroup] = useState<string | null>(null)
  const [questionnaire, setQuestionnaire] = useState<QuestionnaireState | null>(null)
  const [questionnaireLoading, setQuestionnaireLoading] = useState(true)
  const [showEnlarged, setShowEnlarged]     = useState(false)
  const [showCaptureModal, setShowCaptureModal] = useState(false)
  const [showBottomSheet, setShowBottomSheet]   = useState(false)

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
          if (!cancelled) setAgeGroup(json.customer?.ageGroup ?? null)
        }
      } catch {
        /* 取得失敗時は年代欄を空のまま(致命的にしない) */
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
            {customer.name} さま
          </p>
          <p style={{ margin: 0, fontSize: '13px', color: PALETTE.muted }}>
            {ageGroup ? `年代: ${ageGroup}` : '年代: 未登録'}
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

        {/* 既存機能への導線 */}
        <button
          type="button"
          onClick={() => setShowBottomSheet(true)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            padding: '14px 20px', borderRadius: '14px', border: `1.5px solid ${PALETTE.border}`,
            background: 'none', color: PALETTE.text, fontSize: '14px', fontWeight: 700, cursor: 'pointer',
            fontFamily: headingFont.style.fontFamily,
          }}
        >
          接客ログ / AI Timeline
        </button>

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

      {showBottomSheet && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 80 }}>
          <CustomerBottomSheet
            customer={customer}
            reservation={reservation}
            onClose={() => setShowBottomSheet(false)}
          />
        </div>
      )}
    </div>
  )
}
