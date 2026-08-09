// ================================================================
// useLineStore 初期状態(PHASE LINE-MOCK-HIDE-1)
//
// 実機検証で「サンプル顧客A/B/C」「今日の対応が必要」「未返信4件」等の
// 架空データが、実データの取得可否に関わらず初期状態としてスタッフ画面へ
// 表示されてしまっていたことを確認した。threads/todayContactsの初期値が
// 空配列であり、モック顧客データを二度と混入させないことを確認する。
// ================================================================
import { describe, expect, it } from 'vitest'
import { useLineStore } from '../../src/store/useLineStore'

describe('useLineStore 初期状態', () => {
  it('threadsの初期値は空配列である(モックのサンプル顧客を含まない)', () => {
    expect(useLineStore.getState().threads).toEqual([])
  })

  it('todayContactsの初期値は空配列である(架空の「今日の対応が必要」を含まない)', () => {
    expect(useLineStore.getState().todayContacts).toEqual([])
  })

  it('初期状態のthreads/todayContactsに「サンプル顧客」の文字列を含む項目が無い', () => {
    const state = useLineStore.getState()
    const serialized = JSON.stringify([...state.threads, ...state.todayContacts])
    expect(serialized).not.toContain('サンプル顧客')
  })
})
