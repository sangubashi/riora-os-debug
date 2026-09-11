'use client'
/**
 * StaffProposalSection.tsx
 * デジタル顧客カルテ Phase1-B②: 💡前回の次回提案カード。
 *
 * 【最重要】これはAI提案(booking_prompts/handover_notes/NextActionPanel/
 * CustomerRiskCard/AIProposalCard等)ではない。brain_staff_proposalsに
 * 保存された「スタッフが実際に顧客へ伝えた提案」の履歴のみを表示する。
 * AI候補のテキストをこのコンポーネントへ自動転記する処理は絶対に作らない
 * (このファイルはAI系モジュールを一切importしない)。
 *
 * GoalSection.tsxと同じ「customerIdを受け取り自前でfetchする」自己完結
 * コンポーネント。CustomerBottomSheet本体のstate/useEffectには触れない。
 *
 * 使用API: GET/PATCH /api/customers/[id]/staff-proposals(/[proposalId])
 * (Phase1-A実装済み・無変更)。今回は表示専用APIの新規作成(POST)は行わない。
 *
 * 一覧取得(GET)は読み取り専用。取得した履歴を削除・上書きする処理は無い
 * (画面には最新1件のみ表示するが、APIレスポンス自体には一切手を加えない)。
 * PATCHは画面に表示中のproposal.idのみを対象にする(取り違え防止)。
 *
 * 2026-09-11仕様変更: 単独カードではなく「前回のサマリー」カード内のサブセクションとして
 * 埋め込む形に変更。外枠(背景色・角丸・padding)はCustomerBottomSheet側の親カードが持つため
 * このコンポーネントは持たない(見出し・内容のみ)。
 */
import { useState, useEffect, useCallback, memo } from 'react'
import { toast } from 'sonner'
import { authedFetch } from '@/lib/api/authedFetch'

interface StaffProposalSectionProps {
  customerId: string
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

/** 既存API(brain_staff_proposals.status CHECK制約)の5値に対応する日本語表示。 */
const STATUS_LABELS: Record<StaffProposalStatus, string> = {
  proposed: '提案済み',
  executed: '実施済み',
  declined: '見送り',
  changed:  '内容変更',
  unknown:  '未確認',
}

/** UI上で操作可能な実施結果の3種(仕様の表示例に合わせる)。'unknown'への手動変更ボタンは無い。 */
const ACTIONS: Array<{ status: Extract<StaffProposalStatus, 'executed' | 'changed' | 'declined'>; label: string }> = [
  { status: 'executed', label: '実施済み' },
  { status: 'changed',  label: '変更' },
  { status: 'declined', label: '見送り' },
]

const StaffProposalSectionInner = memo(function StaffProposalSection({ customerId }: StaffProposalSectionProps) {
  const [proposal, setProposal] = useState<StaffProposal | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [updating, setUpdating] = useState(false)

  // 顧客切替時に再取得。最新1件(GETはcreated_at降順で返す、Phase1-A実装済み)のみを画面に保持する。
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setProposal(null)
    void (async () => {
      try {
        const res = await authedFetch(`/api/customers/${customerId}/staff-proposals`)
        if (res.ok) {
          const json = await res.json() as { success: boolean; proposals?: StaffProposal[] }
          if (!cancelled && json.success) {
            setProposal(json.proposals?.[0] ?? null)
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [customerId])

  const updateStatus = useCallback(async (status: StaffProposalStatus) => {
    if (!proposal || updating) return // 二重送信防止
    const proposalId = proposal.id // 画面に表示中のIDのみを対象にする(取り違え防止)
    setUpdating(true)
    try {
      const res = await authedFetch(`/api/customers/${customerId}/staff-proposals/${proposalId}`, {
        method: 'PATCH',
        body:   JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error('update failed')
      const json = await res.json() as { success: boolean; proposal?: StaffProposal }
      if (!json.success || !json.proposal) throw new Error('update failed')
      setProposal(json.proposal)
      toast.success('提案の状態を更新しました', { duration: 1500 })
    } catch {
      toast.error('提案の状態更新に失敗しました')
    } finally {
      setUpdating(false)
    }
  }, [customerId, proposal, updating])

  return (
    <div>
      <p className="text-[11px] tracking-[0.18em] text-[#C8A58C] font-semibold mb-2.5">💡 前回の次回提案</p>

      {loading ? (
        <p className="text-xs text-[#C8A8B0] py-1">読み込み中…</p>
      ) : !proposal ? (
        <p className="text-sm text-[#5C4033] leading-relaxed">前回の次回提案はありません</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          <p className="text-sm text-[#5C4033] leading-relaxed whitespace-pre-wrap">
            「{proposal.proposalText}」
          </p>
          <p className="text-xs text-[#9F7E6C]">
            状態：{STATUS_LABELS[proposal.status]}
          </p>
          <div className="flex gap-1.5">
            {ACTIONS.map(({ status, label }) => {
              const active = proposal.status === status
              return (
                <button
                  key={status}
                  onClick={() => updateStatus(status)}
                  disabled={updating || active}
                  className={`flex-1 py-2 rounded-full text-xs font-semibold border cursor-pointer transition-colors disabled:cursor-default ${
                    active
                      ? 'bg-[#F56E8B] text-white border-[#F56E8B]'
                      : 'bg-white text-[#9F7E6C] border-[#F5E6E8]'
                  } ${updating && !active ? 'opacity-60' : ''}`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
})

StaffProposalSectionInner.displayName = 'StaffProposalSection'
export default StaffProposalSectionInner
