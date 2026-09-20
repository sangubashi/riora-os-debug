'use client'
/**
 * StaffTagBar.tsx — 担当者タグ選択UI(PHASE IPAD-SHARED-LOGIN-1・2026-09-20ユーザー承認)。
 *
 * 店舗共通ログイン(isSharedLogin)の場合のみ意味を持つ表示専用コンポーネント。
 * 状態(localStorageの2時間セッション)はuseStaffTagSession側が持ち、本コンポーネントは
 * 受け取ったprops(tag/needsPrompt)をそのまま描画するだけ。
 *
 * - needsPrompt=true: フルスクリーンの担当者選択プロンプトを表示し、選ぶまで背後の操作を
 *   ブロックする。
 * - tagが選択済み: 画面右上相当に「担当: ◯◯」チップを表示し、タップでいつでも選び直せる
 *   (2時間待たなくてよい)。
 * - isSharedLogin=false: 何も描画しない(個人ログイン時は今まで通り無変更)。
 */
import { useEffect, useState } from 'react'
import { User, ChevronDown } from 'lucide-react'
import { PALETTE, headingFont } from '@/components/customer/shared/PhotoCompareKit'
import { fetchActiveStaffList, type ActiveStaffOption } from '@/lib/staffTag/staffTagApiClient'
import type { StaffTag } from '@/lib/staffTag/useStaffTagSession'

interface Props {
  isSharedLogin: boolean
  tag: StaffTag | null
  needsPrompt: boolean
  onSelect: (tag: StaffTag) => void
  onRequestChange: () => void
}

/** 「担当: ◯◯」チップ。個別に配置できるよう、プロンプト部分とは別に export する。 */
export function StaffTagChip({ tag, onRequestChange }: { tag: StaffTag; onRequestChange: () => void }) {
  return (
    <button
      type="button"
      onClick={onRequestChange}
      style={{
        display: 'flex', alignItems: 'center', gap: '5px',
        padding: '5px 12px', borderRadius: '999px', cursor: 'pointer',
        border: `1px solid ${PALETTE.border}`, background: PALETTE.card, color: PALETTE.text,
        fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0,
      }}
    >
      <User size={11} strokeWidth={2} color={PALETTE.gold} />
      担当: {tag.name}
      <ChevronDown size={11} strokeWidth={2} />
    </button>
  )
}

export default function StaffTagBar({ isSharedLogin, tag, needsPrompt, onSelect, onRequestChange }: Props) {
  const [options, setOptions] = useState<ActiveStaffOption[] | null>(null)
  // チップタップによる「選び直し」中は、needsPromptがfalseでも同じプロンプトを出す。
  const [changing, setChanging] = useState(false)

  const showPrompt = needsPrompt || changing

  useEffect(() => {
    if (!showPrompt) return
    let cancelled = false
    void fetchActiveStaffList().then(list => { if (!cancelled) setOptions(list) })
    return () => { cancelled = true }
  }, [showPrompt])

  if (!isSharedLogin) return null

  if (!showPrompt) {
    return tag ? <StaffTagChip tag={tag} onRequestChange={() => setChanging(true)} /> : null
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(30,24,16,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px',
      }}
    >
      <div
        style={{
          background: PALETTE.bg, borderRadius: '20px', width: '100%', maxWidth: '420px',
          padding: '28px 24px', border: `1px solid ${PALETTE.border}`,
        }}
      >
        <p
          style={{
            margin: '0 0 6px', fontSize: '17px', color: PALETTE.gold, textAlign: 'center',
            fontFamily: headingFont.style.fontFamily,
          }}
        >
          担当スタッフを選択してください
        </p>
        <p style={{ margin: '0 0 20px', fontSize: '12px', color: PALETTE.muted, textAlign: 'center', lineHeight: 1.6 }}>
          この端末は店舗共通ログインです。撮影・カルテメモの記録に使う担当者を選んでください。
          選択内容は2時間、他の顧客のカルテを開いても保持されます。
        </p>

        {options === null ? (
          <p style={{ textAlign: 'center', fontSize: '12px', color: PALETTE.muted }}>読み込み中…</p>
        ) : options.length === 0 ? (
          <p style={{ textAlign: 'center', fontSize: '12px', color: PALETTE.muted }}>選択可能なスタッフが見つかりません</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {options.map(o => (
              <button
                key={o.id}
                type="button"
                onClick={() => { onSelect({ id: o.id, name: o.name }); setChanging(false) }}
                style={{
                  padding: '14px', borderRadius: '12px', fontSize: '14px', fontWeight: 700,
                  cursor: 'pointer', border: `1.5px solid ${PALETTE.gold}`,
                  background: 'transparent', color: PALETTE.text,
                }}
              >
                {o.name}
              </button>
            ))}
          </div>
        )}

        {changing && tag && (
          <button
            type="button"
            onClick={() => setChanging(false)}
            style={{
              display: 'block', margin: '16px auto 0', background: 'none', border: 'none',
              color: PALETTE.muted, fontSize: '12px', cursor: 'pointer',
            }}
          >
            キャンセル
          </button>
        )}
      </div>
    </div>
  )
}
