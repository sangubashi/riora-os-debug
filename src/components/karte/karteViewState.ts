/**
 * karteViewState.ts — `/karte/[customerId]`(KarteCustomerSwitcher.tsx)の画面状態の遷移(純粋関数)。
 *
 * 「スタッフ用カルテを見てよい」状態は mode==='staff' のときだけ。この状態になれるのは、お客様用カルテ側で
 * 4桁PIN(StaffPinModal)を正しく入力して 'switch_to_staff' が発行されたときだけにする。
 *
 * 不具合修正(2026-10-02): スタッフ用カルテから「お客様トップ」を開いても mode が 'staff' のまま残り、
 * トップの「詳細ページを見る」でトップのオーバーレイを閉じるだけで、PINなしでスタッフ用カルテが
 * 見えてしまっていた。トップを開く/詳細ページへ進む時点で必ず mode を 'customer' に戻し、
 * スタッフ用カルテへは毎回PINを通さないと戻れないようにした。
 */

export type KarteViewMode = 'customer' | 'staff'

export interface KarteViewState {
  mode:             KarteViewMode
  /** スタッフ用カルテを一度でもマウントしたか(再フェッチを避けるため、以降はdisplayで隠すだけ)。 */
  staffViewMounted: boolean
  /** お客様トップページのオーバーレイを表示中か。 */
  showCustomerTop:  boolean
}

export type KarteViewAction =
  | 'switch_to_staff'      // PIN認証に成功した
  | 'switch_to_customer'   // スタッフ用カルテの「お客様用カルテへ戻る」
  | 'show_customer_top'    // 「お客様トップ」ボタン(お客様用/スタッフ用どちらからも)
  | 'close_customer_top'   // トップを閉じる(×)
  | 'go_to_detail'         // トップの「詳細ページを見る」
  | 'reset'                // 顧客が切り替わった

export const initialKarteViewState: KarteViewState = {
  mode: 'customer', staffViewMounted: false, showCustomerTop: false,
}

export function reduceKarteView(state: KarteViewState, action: KarteViewAction): KarteViewState {
  switch (action) {
    case 'switch_to_staff':
      return { mode: 'staff', staffViewMounted: true, showCustomerTop: false }
    case 'switch_to_customer':
      return { ...state, mode: 'customer' }
    case 'show_customer_top':
    case 'go_to_detail':
    case 'close_customer_top':
      // トップへ出た/トップから戻った時点で、スタッフ用カルテの閲覧権は必ず失効させる(PINの再入力が必要)。
      return { ...state, mode: 'customer', showCustomerTop: action === 'show_customer_top' }
    case 'reset':
      return initialKarteViewState
  }
}
