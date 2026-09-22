/**
 * constants.ts — DEMO_MODE運用の単一店舗ID
 *
 * 現状(DEMO_MODE=true)はマルチ店舗UIが無く、フロントから storeId を渡す手段が
 * 無いため、CSV Import Management(画面⑥)のAPI呼び出し・ルート双方がこれを既定値とする。
 * 複数店舗対応時はログイン中ユーザーのstore_idに置き換える。
 */
export const DEMO_STORE_ID = '00000000-0000-0000-0000-000000000001'

/**
 * iPad用「店舗共通ログイン」アカウントのauth.users.id(PHASE IPAD-SHARED-LOGIN-1・
 * 2026-09-20ユーザー承認)。
 *
 * この定数の用途は2つ:
 *   1. 担当者タグ候補一覧(GET /api/staff/active-list)から、この共通アカウント自身の
 *      brain_staff行を除外する(実在のスタッフとして選べてしまわないようにするため)。
 *   2. 写真登録・カルテメモ登録APIが受け付ける任意の`staffId`上書きを、この共通
 *      アカウントでログイン中のリクエストからのみ許可する(個人ログイン時に他スタッフへ
 *      なりすます経路を塞ぐため)。
 *
 * 値はEmail/Passwordとセットでauth.admin.createUser()により作成済み(仮パスワード、
 * 久保田さんの指定後に差し替え予定)。DEMO_STORE_ID/ADMIN_EMAILと同じ「クライアント
 * バンドルに含まれても問題ない公開識別子を定数で持つ」方針(ユーザーIDそのものは
 * 秘匿情報ではない)。
 */
export const SHARED_IPAD_STAFF_USER_ID = '7e29dcfb-20ce-4f7c-8793-6b46b2f2aa60'

/**
 * 担当者タグ選択(GET /api/staff/active-list)の候補一覧から除外する`brain_staff.id`
 * (PHASE IPAD-SHARED-LOGIN-1・2026-09-20ユーザー承認)。
 *
 * 「久保田」(brain_staff.id=00000000-0000-0000-0000-000000000104)を除外する。
 * このuser_idはadmin@salon-riora.jpアカウントと同一(現場施術を行うスタッフではなく
 * オーナー/管理者のため、iPad担当者タグの選択肢としては不適切)。`is_active=false`には
 * しない(is_active=falseはextractStaffFromRequestで退職済み扱いとなりログイン自体が
 * できなくなるため、admin@salon-riora.jpのログインを壊してしまう)。あくまでこの一覧
 * APIのSELECT結果からのみ除外する、限定的な変更。
 *
 * 今後さらに除外対象が増える場合はこの配列に追加するだけでよい。
 */
export const STAFF_TAG_EXCLUDED_IDS: string[] = [
  '00000000-0000-0000-0000-000000000104', // 久保田(admin@salon-riora.jpと同一)
]

/**
 * 音声メモ機能の緊急停止フラグ(2026-09-15応急対応)。
 *
 * 背景: 実運用での利用実績が無い一方、録音・保存経路自体は生きている状態だった
 * (Whisper未接続のため文字起こしは機能しないが、保存自体は実際にDB/Storageへ
 * 書き込む実装のまま)。VM-8の本格再実装(過去のレポートと実コードの食い違いを
 * 含めた再調査)に着手するまでの間、誤操作によるリスクを防ぐため一時的に無効化する。
 *
 * true = 録音・保存・過去メモ閲覧すべてを非表示にし、代わりに準備中メッセージを表示
 * (VoiceMemoSection.tsx参照)。VM-8実装完了後にfalseへ戻す。
 */
export const VOICE_MEMO_DISABLED = true

/**
 * Hot Pepper Beauty自動取込機能(2026-09-22ユーザー承認)の既定取込元URL。
 * DEMO_STORE_ID/ADMIN_EMAILと同じ「クライアントに含まれてよい公開識別子」方針
 * (サロン自身の公開クーポンページであり秘匿情報ではない)。
 * 複数店舗対応時は店舗ごとの設定値に置き換える想定(現状は単一店舗のため定数)。
 */
export const HOTPEPPER_MENU_URL = 'https://beauty.hotpepper.jp/kr/slnH000808958/coupon/'
