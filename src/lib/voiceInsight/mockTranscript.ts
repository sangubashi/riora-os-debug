/**
 * mockTranscript.ts
 * 音声文字起こしのモック実装。
 *
 * 将来の差し替えポイント:
 *   - OpenAI Whisper API
 *   - Google Speech-to-Text
 *   - Supabase Edge Function 経由の Whisper
 *
 * 現在は duration_sec ベースのプレースホルダーテキストを返す。
 * 実際の音声は storage_path から取得可能だが、
 * クライアントサイドでの文字起こしは非推奨（精度・コスト）のため、
 * Edge Function 化を前提とした非同期インターフェースとして設計。
 */

export interface TranscribeParams {
  storagePath:  string
  durationSec:  number | null
  /** true = 本番AI呼び出し（将来実装）/ false = mock */
  useLiveAI?:   boolean
}

export interface TranscribeResult {
  transcript:  string | null
  isMock:      boolean
  error:       string | null
}

/**
 * 音声を文字起こしする。
 * 現在は mock を返す。将来ここを Whisper API に差し替える。
 */
export async function transcribeAudio(params: TranscribeParams): Promise<TranscribeResult> {
  const { durationSec, useLiveAI = false } = params

  // 将来: useLiveAI = true の場合は実API呼び出し
  if (useLiveAI) {
    // TODO: Supabase Edge Function 経由で Whisper を呼ぶ
    // const { data } = await supabase.functions.invoke('transcribe-audio', { body: { storagePath } })
    return { transcript: null, isMock: false, error: '本番AI未実装' }
  }

  // mock: 録音秒数に応じたプレースホルダー
  const placeholder = buildMockTranscript(durationSec ?? 0)
  return { transcript: placeholder, isMock: true, error: null }
}

// ─── モックテキスト生成 ────────────────────────────────────────────────────────

function buildMockTranscript(durationSec: number): string {
  // 短い録音（〜15秒）
  if (durationSec <= 15) {
    return '[音声メモ] お肌の状態と次回の提案について記録しました。'
  }
  // 中程度（15〜45秒）
  if (durationSec <= 45) {
    return '[音声メモ] 今日の施術について。お客様のお肌の調子と、ご要望、次回来店のご意向について記録しました。（AI文字起こし未実装 — 将来自動生成）'
  }
  // 長め（45秒〜）
  return '[音声メモ] 詳細な接客メモを録音しました。施術内容、顧客の反応、提案した商品、次回の施術プランについて話しました。（AI文字起こし未実装 — 将来自動生成）'
}
