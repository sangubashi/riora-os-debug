'use client'
/**
 * useStaffTagSession.ts — 担当者タグの端末側セッション保持(PHASE IPAD-SHARED-LOGIN-1・
 * 2026-09-20ユーザー承認)。
 *
 * 店舗共通ログイン利用時のみ意味を持つ。一度選択した担当者タグをlocalStorageへ
 * 選択時刻と共に保存し、2時間以内であれば次にどの顧客のカルテを開いても選択プロンプトを
 * 再表示しない(顧客ID単位のリセットではなく、端末単位・時間制のセッション)。
 * 2時間を過ぎた場合、または画面上部の「担当: ◯◯」チップをタップした場合のみ
 * 再選択を求める。アイドルタイムアウト・重要操作PINは実装しない(2026-09-20ユーザー承認)。
 */
import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'riora_staff_tag_session_v1'
const SESSION_TTL_MS = 2 * 60 * 60 * 1000 // 2時間

export interface StaffTag {
  id:   string
  name: string
}

interface StoredStaffTagSession {
  staffId:    string
  staffName:  string
  selectedAt: number
}

function loadFromStorage(): StaffTag | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredStaffTagSession
    if (Date.now() - parsed.selectedAt >= SESSION_TTL_MS) {
      window.localStorage.removeItem(STORAGE_KEY)
      return null
    }
    return { id: parsed.staffId, name: parsed.staffName }
  } catch {
    return null
  }
}

export interface UseStaffTagSessionResult {
  /** 現在保持中の担当者タグ。未選択/期限切れならnull。 */
  tag: StaffTag | null
  /** 選択完了直後、または初期化直後にtrueになる(localStorage読み込み完了フラグ)。 */
  loaded: boolean
  /** プロンプトを表示すべきか(店舗共通ログイン中かつtag未選択/期限切れの場合のみtrue)。 */
  needsPrompt: boolean
  /** 担当者を選択(または変更)する。選択時刻を現在時刻でlocalStorageへ保存する。 */
  setTag: (tag: StaffTag) => void
  /** 「担当: ◯◯」チップのタップ等で明示的に選び直しを求める。 */
  clearTag: () => void
}

/**
 * @param isSharedLogin 現在のログインが店舗共通アカウントかどうか。falseの場合は
 *   一切のプロンプト・チップ表示ロジックを無効化する(個人ログイン時は今まで通り無変更)。
 */
export function useStaffTagSession(isSharedLogin: boolean): UseStaffTagSessionResult {
  const [tag, setTagState] = useState<StaffTag | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!isSharedLogin) {
      setLoaded(true)
      return
    }
    setTagState(loadFromStorage())
    setLoaded(true)
  }, [isSharedLogin])

  const setTag = useCallback((next: StaffTag) => {
    setTagState(next)
    try {
      const stored: StoredStaffTagSession = { staffId: next.id, staffName: next.name, selectedAt: Date.now() }
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
    } catch {
      // 保存できなくても致命的ではない(このタブ内での選択状態は維持される)
    }
  }, [])

  const clearTag = useCallback(() => {
    setTagState(null)
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      // 削除できなくても致命的ではない
    }
  }, [])

  return {
    tag,
    loaded,
    needsPrompt: isSharedLogin && loaded && tag === null,
    setTag,
    clearTag,
  }
}
