/**
 * notifications.ts — アプリ内通知 v1 の型定義
 *
 * Riora_アプリ内通知v1_祝福気遣いカード_設計書_v1.0.md 準拠。
 * 新規テーブルは使わず、既存データから都度計算する（notificationsテーブルは作らない）。
 * スコア・ランク・VIP等の評価系フィールドは持たない（事実のみ）。
 */

export type NotificationKind =
  | 'birthday'
  | 'anniversary_visit'    // 🎉記念日(§3-3): 初回来店1年
  | 'wedding'
  | 'homecare_usage_guide' // ①購入直後(0日): 使い方カード
  | 'homecare_checkin'     // ②購入+7日: 使い心地確認
  | 'homecare_replenish'   // ③補充の頃(duration_daysの85〜90%地点): 補充前通知
  | 'no_visit_60'
  | 'skin_improving'
  | 'visit_reminder'       // 🔔来店リマインド(§3-4): 前日〜当日、重要メモ添付
  | 'new_reservation'      // 📋新規予約(§1): 週1CSV取込後の差分
  | 'churn_risk_admin'     // ⚠️離脱予兆(§1管理者向け・isAdmin限定)
  | 'approval_pending_admin' // 📊承認待ち(§1管理者向け・isAdmin限定)

export interface StaffNotification {
  id:           string // `${kind}:${customerId}` で合成（保存しない一時ID）
  kind:         NotificationKind
  emoji:        string
  title:        string
  /** 管理者向け集計通知(churn_risk_admin/approval_pending_admin)は特定の顧客に
   *  紐づかないため未設定。それ以外の種別では常に設定される。 */
  customerId?:   string
  customerName?: string
  /** 来店リマインド等、複数行の内容を持つ通知用(任意)。禁忌→重要メモ→会話メモの順。 */
  detail?:      string[]
}

export interface NotificationsResponse {
  success:        boolean
  notifications:  StaffNotification[]
  scannedCount:   number
  error?:         string
}
