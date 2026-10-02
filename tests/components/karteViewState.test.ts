// /karte/[customerId] の画面状態遷移: スタッフ用カルテはPINを通した後でしか見えない(2026-10-02不具合修正)
import { describe, expect, it } from 'vitest'
import {
  initialKarteViewState, reduceKarteView, type KarteViewAction, type KarteViewState,
} from '../../src/components/karte/karteViewState'

const run = (actions: KarteViewAction[], from: KarteViewState = initialKarteViewState) =>
  actions.reduce(reduceKarteView, from)

describe('karteViewState', () => {
  it('開いた直後はお客様用カルテで、スタッフ用カルテは未マウント', () => {
    expect(initialKarteViewState).toEqual({ mode: 'customer', staffViewMounted: false, showCustomerTop: false })
  })

  it('PIN成功(switch_to_staff)でだけスタッフ用カルテになる', () => {
    const s = run(['switch_to_staff'])
    expect(s).toEqual({ mode: 'staff', staffViewMounted: true, showCustomerTop: false })
  })

  it('【不具合の再現手順】スタッフ → お客様トップ → 詳細ページを見る、でスタッフ用カルテに戻らない', () => {
    const s = run(['switch_to_staff', 'show_customer_top', 'go_to_detail'])
    expect(s.mode).toBe('customer')          // PINなしでスタッフ用カルテが見えない
    expect(s.showCustomerTop).toBe(false)
    expect(s.staffViewMounted).toBe(true)    // 再フェッチを避けるためマウントは維持(表示は隠れる)
  })

  it('お客様トップを開いた時点でスタッフ権限は失効する(トップの裏にスタッフ用カルテが残らない)', () => {
    const s = run(['switch_to_staff', 'show_customer_top'])
    expect(s).toEqual({ mode: 'customer', staffViewMounted: true, showCustomerTop: true })
  })

  it('トップを×で閉じてもスタッフ用カルテには戻らない', () => {
    expect(run(['switch_to_staff', 'show_customer_top', 'close_customer_top']).mode).toBe('customer')
  })

  it('何度往復しても、スタッフ用カルテへ戻るには毎回 switch_to_staff(PIN成功)が必要', () => {
    let s = run(['switch_to_staff', 'show_customer_top', 'go_to_detail'])
    expect(s.mode).toBe('customer')
    s = run(['show_customer_top', 'go_to_detail'], s)
    expect(s.mode).toBe('customer')
    s = run(['switch_to_staff'], s)          // PIN成功
    expect(s.mode).toBe('staff')
    s = run(['show_customer_top', 'go_to_detail'], s)
    expect(s.mode).toBe('customer')          // 2回目以降もPINが必要
  })

  it('お客様用カルテからトップへ → 詳細ページを見る でも、お客様用カルテのまま', () => {
    expect(run(['show_customer_top', 'go_to_detail'])).toEqual({ mode: 'customer', staffViewMounted: false, showCustomerTop: false })
  })

  it('「お客様用カルテへ戻る」でお客様用に戻る。顧客が変わったら全てリセット', () => {
    expect(run(['switch_to_staff', 'switch_to_customer']).mode).toBe('customer')
    expect(run(['switch_to_staff', 'show_customer_top', 'reset'])).toEqual(initialKarteViewState)
  })
})
