/**
 * generateCard.ts — 祝福・気遣いカード生成(CardGenerator・正式実装)
 *
 * Riora_アプリ内通知v1_祝福気遣いカード_設計書_v1.0.md §3-1(誕生日)・
 * §3-3(記念日)準拠。テンプレ差し込みのみ・LLM不使用・決定論的(純粋関数)。
 * AUTH-2(担当粒度)はこのモジュール自体では扱わない(呼び出し元のAPI Routeが
 * canAccessCustomer/AUTH-2を適用済みのデータのみをここへ渡す前提)。
 *
 * 【鉄則】誕生日カードにクーポン・特典・次回予約の誘導を絶対に混ぜない
 * (設計書§3-1「祝福に商売を混ぜると純度が落ちる」)。本ファイルのテンプレートは
 * いずれも祝福・感謝の文言のみで構成し、営業要素を含む文字列を差し込む口を
 * 一切持たない設計にしている。
 *
 * memory_soft(パターンB差し込み文)の選定ルール(2026-07-19 レビュー対応で厳格化):
 *   - is_sensitive=true のメモは除外(設計書§5「sensitiveタグは使わない」)
 *   - memory_type は family/life_event/travel/pet/hobby の**許可リスト方式**のみ
 *     採用する(anniversary/occupation/otherは対象外。以前は優先順位付けの
 *     最下位として許容していたが、業務メモが誕生日カードに混入するリスクが
 *     あったため許可リスト方式に変更した)
 *   - 上記の型に一致していても、内容が禁忌・施術・商品・予約・売上・クレーム等の
 *     業務文脈を含む場合はキーワード判定で除外する(CONTEXT_EXCLUSION_KEYWORDS)。
 *     memory_typeの分類は運用上ぶれる可能性があるため、内容面でも二重に防御する
 *   - 許可リストの優先順位: family > life_event > travel > pet > hobby
 *     (同順位内では最新のものを採用)
 *   - 候補が1件も無い場合はnullを返す。呼び出し側(generateCelebrationCards)は
 *     memorySoft=nullのときpatternBを生成せず、自動的にパターンAのみになる
 *     (フォールバック設計)
 *   - LLMによる言い換え・要約は一切行わない。customer_memories.contentを
 *     そのまま差し込む(テンプレ差し込みのみという制約上、これが誠実な実装。
 *     ただし上記の除外フィルタにより、差し込まれる内容自体を「柔らかい」
 *     カテゴリに絞り込んでいる)
 */
import type { StaffNotification } from '@/types/notifications'
import { sanitizeForYakukihou } from './yakukihouCheck'

export interface CelebrationCard {
  id:         string
  kind:       'birthday' | 'anniversary_visit' | 'wedding' | 'homecare_usage_guide' | 'homecare_checkin' | 'homecare_replenish'
  emoji:      string
  headline:   string
  suggestion: string
  /** 誕生日・記念日のみ: LINEにそのままコピーできる全文テンプレート。他種別は未設定。 */
  fullText?: {
    patternA: string
    /** memory_softが選定できた場合のみ存在。無ければパターン切替UIはパターンAのみ表示する。 */
    patternB?: string
  }
}

export interface MemoryCandidate {
  memoryType: string
  content:    string
  isSensitive: boolean
  createdAt:  string
}

const CARD_ELIGIBLE_KINDS = new Set([
  'birthday', 'anniversary_visit', 'wedding', 'homecare_usage_guide', 'homecare_checkin', 'homecare_replenish',
])

// 誕生日文脈に許可する「柔らかい」memory_typeの許可リスト(値が小さいほど優先)。
// これに無い型(anniversary/occupation/other等)は一切候補にしない。
const SOFT_MEMORY_TYPE_PRIORITY: Record<string, number> = {
  family:     0,
  life_event: 1,
  travel:     2,
  pet:        3,
  hobby:      4,
}

// 業務文脈を含む内容を除外するためのキーワード判定。memory_typeの分類だけに
// 頼らず、内容面でも二重に防御する(誕生日カードに禁忌・施術・商品・予約・
// 売上・クレーム等が紛れ込むのを防ぐ)。
const CONTEXT_EXCLUSION_KEYWORDS: Record<string, string[]> = {
  contraindication: ['禁忌', 'アレルギー', 'レチノール', '炎症', '使用中止', '皮膚炎', 'かぶれ', '副作用', '注意事項'],
  treatment:        ['施術', 'トリートメント', 'フェイシャル', 'コース', 'メニュー', 'ケア'],
  product:          ['購入', '商品', '使い方', '化粧水', '美容液', 'クリーム', 'セラム', 'ローション', 'サプリ', '在庫', '補充'],
  reservation:      ['予約', '来店', 'スケジュール', 'キャンセル'],
  sales:            ['円', '売上', '金額', '価格', '割引', '会計'],
  complaint:        ['クレーム', '不満', '苦情', '申し訳', 'ご迷惑', 'お怒り'],
}

function containsExcludedContext(content: string): boolean {
  return Object.values(CONTEXT_EXCLUSION_KEYWORDS).some((keywords) => keywords.some((kw) => content.includes(kw)))
}

/**
 * 誕生日カードのパターンBに差し込む「柔らかい一言」を選ぶ(純粋関数)。
 * family/life_event/travel/pet/hobby以外の型、または業務文脈を含む内容は
 * 一切対象にしない。該当が無ければnull(呼び出し側はパターンAへフォールバック)。
 */
export function selectMemorySoft(memories: MemoryCandidate[]): string | null {
  const eligible = memories.filter(
    (m) =>
      !m.isSensitive &&
      m.memoryType in SOFT_MEMORY_TYPE_PRIORITY &&
      m.content.trim().length > 0 &&
      !containsExcludedContext(m.content)
  )
  if (eligible.length === 0) return null

  eligible.sort((a, b) => {
    const pa = SOFT_MEMORY_TYPE_PRIORITY[a.memoryType]
    const pb = SOFT_MEMORY_TYPE_PRIORITY[b.memoryType]
    if (pa !== pb) return pa - pb
    return a.createdAt < b.createdAt ? 1 : -1 // 同順位内は新しい順
  })
  return eligible[0].content
}

function buildBirthdayPatternA(customerName: string): string {
  return [
    `${customerName}様`,
    'お誕生日おめでとうございます🎂',
    '素敵な一年になりますように。',
    'またお会いできるのを楽しみにしております🌿',
  ].join('\n')
}

function buildBirthdayPatternB(customerName: string, memorySoft: string): string {
  return [
    `${customerName}様`,
    'お誕生日おめでとうございます🎂',
    memorySoft,
    'どうかご自愛くださいね。',
    'またお会いできる日を楽しみにしております🌿',
  ].join('\n')
}

function buildAnniversaryCard(customerName: string): string {
  return [
    `${customerName}様`,
    'いつもありがとうございます🌿',
    '当サロンにお越しいただいて、',
    'ちょうど1年になりました。',
    'これからもお肌のこと、',
    '一緒に大切にさせてくださいね。',
  ].join('\n')
}

function buildHeadlineAndSuggestion(n: StaffNotification): { headline: string; suggestion: string } {
  switch (n.kind) {
    case 'birthday':
      return { headline: 'お誕生日が近いです', suggestion: '一言お祝いがおすすめ' }
    case 'anniversary_visit':
      return { headline: '初来店から1年です', suggestion: '記念日カードをお送りしましょう' }
    case 'wedding': {
      const match = n.title.match(/結婚式まで(\d+)日/)
      const days = match ? match[1] : null
      return {
        headline: days ? `結婚式まであと${days}日` : '結婚式が近いです',
        suggestion: '不安がないか確認しましょう',
      }
    }
    // ── ホームケア3種(気遣いカード): 設計書§4「気遣いカードのみ薬機法/NG語
    //    チェック」に対応。商品名(自由記述由来)が差し込まれる箇所のみ、
    //    最終的な文言をcheckYakukihouCompliance相当のsanitizeForYakukihouへ通す。
    //    現状のテンプレート自体は効能断定を含まないため常にsafeを通る想定だが、
    //    将来的な自由記述混入に備えた防御として組み込む。 ─────────────────
    case 'homecare_usage_guide': {
      const product = extractProductPhrase(n.title, ' 使い方カード')
      const headline = product ? `${product}をお渡ししました` : 'ホームケア商品をお渡ししました'
      return {
        headline: sanitizeForYakukihou(headline, 'ホームケア商品をお渡ししました'),
        suggestion: '使い方をご案内しましょう',
      }
    }
    case 'homecare_checkin': {
      const product = extractProductPhrase(n.title, ' 使い心地はいかがですか')
      const headline = product ? `${product}を使い始めて1週間です` : 'ホームケアを使い始めて1週間です'
      return {
        headline: sanitizeForYakukihou(headline, 'ホームケアを使い始めて1週間です'),
        suggestion: '使い心地を聞いてみましょう',
      }
    }
    case 'homecare_replenish': {
      const product = extractProductPhrase(n.title, ' そろそろ補充の頃')
      const headline = product ? `${product}がそろそろ補充の頃です` : 'ホームケアがそろそろ補充の頃です'
      return {
        headline: sanitizeForYakukihou(headline, 'ホームケアがそろそろ補充の頃です'),
        suggestion: '効果実感を一緒に振り返りましょう',
      }
    }
    default:
      return { headline: n.title, suggestion: '' }
  }
}

/** タイトルから「◯◯様 」「(商品名) 」等の付随文言を除いた本体部分を取り出す簡易ヘルパー。 */
function extractProductPhrase(title: string, suffix: string): string | null {
  const idx = title.indexOf(suffix)
  if (idx < 0) return null
  const afterName = title.split('様 ')[1] ?? title
  return afterName.replace(suffix, '').trim() || null
}

/**
 * 通知(顧客1名分)から祝福・気遣いカードを生成する(純粋関数)。
 * memorySoftは呼び出し元(API Route)がselectMemorySoft()で選定した結果を渡す
 * (このモジュール内ではDBアクセスしない)。
 */
export function generateCelebrationCards(
  notifications: StaffNotification[],
  memorySoft: string | null = null
): CelebrationCard[] {
  return notifications
    .filter((n) => CARD_ELIGIBLE_KINDS.has(n.kind))
    .map((n) => {
      const { headline, suggestion } = buildHeadlineAndSuggestion(n)
      const card: CelebrationCard = {
        id: n.id,
        kind: n.kind as CelebrationCard['kind'],
        emoji: n.emoji,
        headline,
        suggestion,
      }

      // birthday/anniversary_visitはCARD_ELIGIBLE_KINDS内の顧客紐付き種別のため
      // customerNameは常に設定されている(管理者向け集計通知のみ未設定になりうる)。
      const customerName = n.customerName ?? ''

      if (n.kind === 'birthday') {
        card.fullText = {
          patternA: buildBirthdayPatternA(customerName),
          ...(memorySoft ? { patternB: buildBirthdayPatternB(customerName, memorySoft) } : {}),
        }
      } else if (n.kind === 'anniversary_visit') {
        card.fullText = { patternA: buildAnniversaryCard(customerName) }
      }

      return card
    })
}
