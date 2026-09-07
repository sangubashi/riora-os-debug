'use client'
/**
 * StaffProposalInputSection.tsx
 * デジタル顧客カルテ Phase1-B⑦: ➡️今日の次回提案カード（「今日入力」エリア専用）。
 *
 * 【重要】ここで記録するのは「今日スタッフが実際に顧客へ伝えた次回提案」であり、
 * AI/ルールベースの提案候補(booking_prompts.recommended_proposals・
 * handover_notes.recommended_actions・BookingPromptSection・HandoverSection・
 * AIProposalCard・NextActionPanel・CustomerRiskCard等)とは完全に別物。
 * AI候補のテキストをこのコンポーネントへ自動転記する処理は一切無い
 * (このファイルはAI系モジュールを一切importしない)。
 *
 * 「前回の次回提案」(B②・StaffProposalSection.tsx、見る側・状態変更ボタンあり)とは
 * 明確に役割を分ける：本コンポーネントは今日の新規記録専用(POSTのみ)で、
 * status変更・編集・削除ボタンは一切実装しない(既存API仕様どおりPOST時は
 * status='proposed'固定。実施結果の管理は次回来店時にB②が担当する)。
 *
 * 使用API: GET/POST /api/customers/[id]/staff-proposals(Phase1-A実装済み・無変更)。
 * GETは常にtodayVisitId限定(?visitId=)で呼び、今日の記録のみを表示する。
 *
 * todayVisitIdがnullの間はGET/POSTともに行わず、入力UIも表示しない
 * (saveLog()/service-completeを変更してvisitIdを作る処理は追加しない)。
 *
 * GoalSection/StaffProposalSection/ProductProposalSection/SkinConditionSection/
 * TreatmentRecordSection/ProductProposalInputSectionと同じく自己完結コンポーネント。
 */
import { useState, useEffect, useCallback, memo } from 'react'
import { toast } from 'sonner'
import { authedFetch } from '@/lib/api/authedFetch'

interface StaffProposalInputSectionProps {
  customerId: string
  /** 本日分のbrain_visits.id。無い場合(通常は接客ログ保存前)はnull。 */
  todayVisitId: string | null
}

type StaffProposalStatus = 'proposed' | 'executed' | 'declined' | 'changed' | 'unknown'

interface StaffProposal {
  id:           string
  visitId:      string | null
  staffId:      string | null
  proposalText: string
  status:       StaffProposalStatus
  createdAt:    string
}

const StaffProposalInputSectionInner = memo(function StaffProposalInputSection({
  customerId,
  todayVisitId,
}: StaffProposalInputSectionProps) {
  const [proposals,    setProposals]    = useState<StaffProposal[]>([])
  const [loading,      setLoading]      = useState(false)
  const [proposalText, setProposalText] = useState('')
  const [saving,       setSaving]       = useState(false)

  const loadTodayProposals = useCallback(async (visitId: string): Promise<StaffProposal[]> => {
    const res = await authedFetch(
      `/api/customers/${customerId}/staff-proposals?visitId=${visitId}`
    )
    if (!res.ok) return []
    const json = await res.json() as { success: boolean; proposals?: StaffProposal[] }
    return json.success ? (json.proposals ?? []) : []
  }, [customerId])

  // 顧客切替・本日visitIdの確定タイミングの両方でリセット+再取得する。
  // todayVisitIdがnullの間はGETしない(案内表示のみ)。
  useEffect(() => {
    let cancelled = false
    setProposals([])
    setProposalText('')

    if (!todayVisitId) {
      setLoading(false)
      return
    }

    setLoading(true)
    void (async () => {
      try {
        const rows = await loadTodayProposals(todayVisitId)
        if (!cancelled) setProposals(rows)
        // 取得失敗時は空欄のまま続行する(loadTodayProposalsは失敗時[]を返す)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [customerId, todayVisitId, loadTodayProposals])

  const canSubmit = !saving && !!todayVisitId && proposalText.trim().length > 0

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !todayVisitId) return // 二重送信防止・未入力ガード
    const trimmedText = proposalText.trim().slice(0, 500)
    setSaving(true)
    try {
      const res = await authedFetch(`/api/customers/${customerId}/staff-proposals`, {
        method: 'POST',
        body: JSON.stringify({
          visitId:      todayVisitId,
          proposalText: trimmedText,
          // staffId/statusはクライアントから送信しない(API側がBearerトークン/既定値で決定する)
        }),
      })
      if (!res.ok) throw new Error('save failed')
      const json = await res.json() as { success: boolean; proposal?: StaffProposal }
      if (!json.success || !json.proposal) throw new Error('save failed')

      // 保存成功後は入力欄をクリアし、今日の一覧を再取得する(楽観的更新はしない)
      setProposalText('')
      const rows = await loadTodayProposals(todayVisitId)
      setProposals(rows)
      toast.success('次回提案を記録しました', { duration: 1500 })
    } catch {
      toast.error('次回提案の記録に失敗しました')
    } finally {
      setSaving(false)
    }
  }, [canSubmit, customerId, todayVisitId, proposalText, loadTodayProposals])

  return (
    <div className="bg-[#F8F1F3] rounded-[22px] p-4">
      <p className="text-[11px] tracking-[0.18em] text-[#C8A58C] font-semibold mb-2.5">
        ➡️ 今日の次回提案
      </p>

      {!todayVisitId ? (
        <p className="text-xs text-[#C8A8B0] leading-relaxed">
          今日の接客記録を保存後に次回提案を記録できます
        </p>
      ) : loading ? (
        <p className="text-xs text-[#C8A8B0] py-1">読み込み中…</p>
      ) : (
        <div className="flex flex-col gap-3">
          {/* 今日の提案一覧(status変更・編集・削除ボタンは無し、記録専用のため) */}
          {proposals.length > 0 ? (
            <div className="flex flex-col gap-1">
              {proposals.map(p => (
                <p key={p.id} className="text-sm text-[#5C4033] leading-relaxed whitespace-pre-wrap break-words">
                  ・{p.proposalText}
                </p>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[#C8A8B0]">まだ今日の次回提案はありません</p>
          )}

          {/* 新規入力 */}
          <textarea
            value={proposalText}
            onChange={e => setProposalText(e.target.value.slice(0, 500))}
            placeholder="次回提案の内容を入力"
            rows={3}
            disabled={saving}
            className="w-full resize-none text-sm text-[#5C4033] bg-white rounded-2xl p-3 border border-[#F5E6E8] outline-none leading-relaxed font-['Noto_Sans_JP'] box-border disabled:opacity-60"
          />

          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={`w-full py-2.5 rounded-full text-sm font-bold text-white transition-colors ${
              !canSubmit ? 'bg-[#F5D6DB] cursor-default' : 'bg-[#F56E8B] cursor-pointer'
            }`}
          >
            {saving ? '記録中…' : '記録する'}
          </button>
        </div>
      )}
    </div>
  )
})

StaffProposalInputSectionInner.displayName = 'StaffProposalInputSection'
export default StaffProposalInputSectionInner
