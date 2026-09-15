/**
 * constants.ts — DEMO_MODE運用の単一店舗ID
 *
 * 現状(DEMO_MODE=true)はマルチ店舗UIが無く、フロントから storeId を渡す手段が
 * 無いため、CSV Import Management(画面⑥)のAPI呼び出し・ルート双方がこれを既定値とする。
 * 複数店舗対応時はログイン中ユーザーのstore_idに置き換える。
 */
export const DEMO_STORE_ID = '00000000-0000-0000-0000-000000000001'

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
