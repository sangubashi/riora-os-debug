/**
 * generateHomecarePlan.ts
 * Deterministic rule-based homecare suggestion engine.
 * NO AI calls. Pure function. 100% testable.
 *
 * 入力: 肌タグ / メニュー名 / 施術後日数 / 季節
 * 出力: HomecarePlan（今日のケア / NG / 注意 / 商品提案 / 来店サイクル / LINE下書き）
 */

import type { HomecarePlan, SkinTagKey } from '@/types'

// ─── 季節判定 ─────────────────────────────────────────────────────────────────

export type Season = '春' | '夏' | '秋' | '冬'

export function getSeason(): Season {
  const m = new Date().getMonth() + 1
  if (m >= 3 && m <= 5)  return '春'
  if (m >= 6 && m <= 8)  return '夏'
  if (m >= 9 && m <= 11) return '秋'
  return '冬'
}

// ─── 推奨来店サイクル（メニューベース） ──────────────────────────────────────

const MENU_CYCLE: Array<{ pattern: RegExp; days: number }> = [
  { pattern: /ハーブ.{0,4}ピーリング/,       days: 21 },
  { pattern: /毛穴/,                          days: 28 },
  { pattern: /ポアクリーニング/,              days: 28 },
  { pattern: /美白/,                          days: 30 },
  { pattern: /エイジング|コラーゲン/,         days: 45 },
  { pattern: /プレミアム/,                    days: 45 },
  { pattern: /水光|ハイドラ|モイスチャー/,    days: 30 },
  { pattern: /スキンケア|ベーシック/,         days: 35 },
  { pattern: /UV|紫外線/,                     days: 28 },
  { pattern: /リラクゼーション/,              days: 42 },
]

export function getMenuCycleDays(menu: string): number {
  for (const { pattern, days } of MENU_CYCLE) {
    if (pattern.test(menu)) return days
  }
  return 35 // デフォルト
}

// ─── 肌タグ → ケア内容マッピング ─────────────────────────────────────────────

interface TagCare {
  care:     string   // 今日やるべきこと
  ng:       string   // NG行動
  caution:  string   // 注意点
  product:  string   // 商品提案
}

const TAG_CARE: Record<SkinTagKey, TagCare> = {
  dry: {
    care:    '朝晩のセラムを惜しまず重ねる',
    ng:      '洗顔後10分以上放置しない',
    caution: 'エアコンの乾燥に注意、加湿器を活用',
    product: 'セラミド配合保湿クリーム',
  },
  oily: {
    care:    '皮脂コントロールのトナーを朝に使用',
    ng:      '洗顔のし過ぎ（1日2回まで）',
    caution: 'Tゾーンのテカリは皮脂分泌過多のサイン、拭き取りより軽く押さえる',
    product: 'ノンコメドジェニック処方の保湿液',
  },
  sensitive: {
    care:    '低刺激の洗顔料と保湿のみに絞る',
    ng:      '複数の新商品を同時に試さない',
    caution: '摩擦に注意、タオルでの強い拭き取りNG',
    product: 'セラミド・アラントイン配合の敏感肌向けローション',
  },
  acne: {
    care:    '清潔と保湿を徹底、触らない',
    ng:      '自己判断での潰しや強い摩擦',
    caution: '枕カバーを清潔に保つ、マスク着用時間を最小限に',
    product: '抗菌・抗炎症処方のスポットジェル',
  },
  pigmentation: {
    care:    '朝の日焼け止めを首まで丁寧に',
    ng:      '紫外線を浴びた直後の高刺激ケア',
    caution: '美白有効成分は夜のみ使用が効果的',
    product: 'ビタミンC誘導体配合美白美容液',
  },
  redness: {
    care:    '低刺激クレンジングで摩擦ゼロを意識',
    ng:      '熱いお湯での洗顔・長時間の入浴',
    caution: '血行促進系のマッサージは赤みを悪化させる可能性あり',
    product: 'グリチルリチン酸配合の鎮静モイスチャー',
  },
  dehydration: {
    care:    '化粧水を手のひらで押し込むようにハンドプレス',
    ng:      'ふき取り化粧水の毎日使用',
    caution: '水をこまめに飲む・コーヒーや塩分の摂りすぎに注意',
    product: 'ヒアルロン酸3種類配合のウォータリーゲル',
  },
  aging: {
    care:    '夜のレチノール系美容液とアイクリームを継続',
    ng:      '表情筋を無意識に動かすクセを意識して減らす',
    caution: '日中はSPF50以上の日焼け止めが必須',
    product: 'ナイアシンアミド・ペプチド配合エイジングクリーム',
  },
  pore: {
    care:    '毛穴汚れを溜めない、ぬるま湯での丁寧な洗顔を1日2回',
    ng:      '毛穴パック・強い皮脂除去アイテムの過度な使用',
    caution: '過剰な洗浄はかえって皮脂分泌を招くため、洗いすぎに注意',
    product: '毛穴引き締め化粧水・ビタミンC誘導体配合の収れん美容液',
  },
}

// ─── 季節ケアアドバイス ───────────────────────────────────────────────────────

const SEASON_CARE: Record<Season, string> = {
  春: '花粉・UV量増加の季節。バリア機能を高める保湿と日焼け止めを忘れずに',
  夏: '汗と紫外線でダメージが蓄積しやすい時期。クレンジングは丁寧に、保湿は多めに',
  秋: '夏のダメージが出やすく乾燥も始まる季節。シミ・ハリケアに重点を',
  冬: '乾燥・冷えで肌バリアが低下しやすい。油分を含むリッチなクリームへの切り替えを',
}

// ─── LINE下書き生成 ───────────────────────────────────────────────────────────

function buildLineDraft(params: {
  name:          string
  tags:          SkinTagKey[]
  menu:          string
  daysAfterVisit: number
  cycleDays:     number
  season:        Season
}): string {
  const { name, tags, daysAfterVisit, cycleDays, season } = params
  const firstName = name.replace(/\s+様?$/, '').split(/\s+/)[0] ?? name

  // 来店後日数に応じたメッセージトーン
  let opening: string
  if (daysAfterVisit <= 3) {
    opening = `この度はご来店いただきありがとうございました✨`
  } else if (daysAfterVisit <= 14) {
    opening = `先日のご来店から少し経ちましたが、お肌の調子はいかがでしょうか？`
  } else if (daysAfterVisit <= 30) {
    opening = `${daysAfterVisit}日が経ちました。お肌のケア続けていますか？`
  } else {
    opening = `そろそろお肌のメンテナンス時期かと思いご連絡しました😊`
  }

  // 肌タグベースのアドバイス（最大1つ）
  let tagAdvice = ''
  const primaryTag = tags[0]
  if (primaryTag) {
    const seasonNote: Record<Season, Partial<Record<SkinTagKey, string>>> = {
      春: { dry: '花粉シーズンの乾燥対策に保湿を強めに', sensitive: '花粉で敏感になりやすい時期なので低刺激ケアを', pigmentation: '春のUVが強くなる前に美白ケアのスタートを' },
      夏: { dry: '冷房の乾燥に注意して保湿を忘れずに', oily: 'テカりやすい季節ですが保湿は抜かずに', pigmentation: '日焼け止め毎日忘れずに！' },
      秋: { dry: '夏の乾燥ダメージ、しっかり保湿で補修を', aging: '秋はエイジングケアのゴールデンタイムです', pigmentation: '夏のシミケアをこの季節に集中的に' },
      冬: { dry: '乾燥しやすい時期なので保湿を強め意識してみてください', sensitive: '乾燥で肌が敏感になりやすいので刺激を減らして', dehydration: '水分が逃げやすい季節、インナーケアも大切に' },
    }
    tagAdvice = seasonNote[season]?.[primaryTag]
      ?? TAG_CARE[primaryTag].care
  }

  // 次回来店タイミング
  const remaining = cycleDays - daysAfterVisit
  let visitHint = ''
  if (remaining <= 7 && remaining > 0) {
    visitHint = `次回のご来店がそろそろ良いタイミングです🗓️`
  } else if (remaining <= 0) {
    visitHint = `お肌のメンテナンス時期が来ています、ぜひご来店お待ちしています😊`
  }

  const parts = [
    `${firstName}さん、こんにちは🌸`,
    opening,
    tagAdvice && tagAdvice,
    visitHint && visitHint,
    `気になることがあれば、いつでもご連絡くださいね😊`,
  ].filter(Boolean)

  return parts.join('\n')
}

// ─── メイン関数 ───────────────────────────────────────────────────────────────

export interface HomecarePlanInput {
  customerName:    string
  skinTags:        SkinTagKey[]
  menuName:        string
  daysAfterVisit:  number   // 施術後日数（0 = 今日施術）
  season?:         Season   // 省略時は自動判定
}

export function generateHomecarePlan(input: HomecarePlanInput): HomecarePlan {
  const {
    customerName,
    skinTags,
    menuName,
    daysAfterVisit,
    season = getSeason(),
  } = input

  const cycleDays = getMenuCycleDays(menuName)

  // 肌タグからケア内容を集約（最大3タグ）
  const activeTags = skinTags.slice(0, 3)

  const todayCare:  string[] = []
  const ngActions:  string[] = []
  const cautions:   string[] = []
  const products:   string[] = []

  for (const tag of activeTags) {
    const care = TAG_CARE[tag]
    if (care) {
      todayCare.push(care.care)
      ngActions.push(care.ng)
      cautions.push(care.caution)
      products.push(care.product)
    }
  }

  // タグなし時のデフォルト
  if (todayCare.length === 0) {
    todayCare.push('洗顔・保湿の基本2ステップを丁寧に継続')
    ngActions.push('複数商品の同時切り替え')
    cautions.push(SEASON_CARE[season])
    products.push('肌質に合った保湿アイテム（スタッフにご相談を）')
  } else {
    // 季節ケアを cautions に追加
    cautions.push(SEASON_CARE[season])
  }

  const lineDraft = buildLineDraft({
    name: customerName,
    tags: activeTags,
    menu: menuName,
    daysAfterVisit,
    cycleDays,
    season,
  })

  return {
    todayCare:  Array.from(new Set(todayCare)),
    ngActions:  Array.from(new Set(ngActions)),
    cautions:   Array.from(new Set(cautions)),
    products:   Array.from(new Set(products)),
    cycleDays,
    lineDraft,
  }
}

// ─── 再来推奨タイミング ────────────────────────────────────────────────────────

export interface ReturnTiming {
  cycleDays:       number   // 推奨サイクル
  daysRemaining:   number   // 残り日数（マイナス = 超過）
  isOverdue:       boolean  // 超過フラグ
  isDanger:        boolean  // 60日超
  label:           string   // 表示文字列
}

export function getReturnTiming(
  menuName: string,
  daysSinceVisit: number
): ReturnTiming {
  const cycleDays     = getMenuCycleDays(menuName)
  const daysRemaining = cycleDays - daysSinceVisit
  const isOverdue     = daysRemaining < 0
  const isDanger      = daysSinceVisit >= 60

  let label: string
  if (isDanger) {
    label = `⚠️ ${daysSinceVisit}日超過 — 失客リスク`
  } else if (isOverdue) {
    label = `再来時期超過 +${Math.abs(daysRemaining)}日`
  } else if (daysRemaining <= 7) {
    label = `再来推奨 あと${daysRemaining}日`
  } else {
    label = `次回目安 あと${daysRemaining}日`
  }

  return { cycleDays, daysRemaining, isOverdue, isDanger, label }
}
