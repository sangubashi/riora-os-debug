/**
 * computeStaffHighlights.ts — スタッフ分析カードの「今月良かったこと」「今月おすすめ改善ポイント」
 * (管理者分析完成度向上・API変更禁止のため実装)
 *
 * StaffAnalyticsEngine.computeStaffAnalytics()が既に返している値(nominationRate/
 * repeatRate/growthRate/avgSpend)だけを入力に取る純粋関数。新しいAPI呼び出し・
 * DB集計は一切行わない。ホームケア率・再予約率はAPIレスポンスに含まれていないため、
 * それらを主題にした文言は生成しない(実データが無い主張をしない)。
 *
 * 制約(2026-06-23ユーザー指示): ランキング禁止・スタッフ間比較禁止。この関数は
 * 他スタッフの値を一切参照せず、そのスタッフ1人の値だけから文章を選ぶ。
 * 数値は文章に含めない(前向きな文章のみ)。
 */

export interface StaffHighlightInput {
  nominationRate: number | null
  repeatRate: number | null
  growthRate: number | null
  avgSpend: number | null
  visitCount: number
}

export interface StaffHighlight {
  goodNote: string
  improvementNote: string
}

export function computeStaffHighlight(input: StaffHighlightInput): StaffHighlight {
  let goodNote = '今月も接客を通じてお客様と向き合っています。'
  if (input.growthRate !== null && input.growthRate > 0.05) {
    goodNote = '先月に比べて成果が伸びています。'
  } else if (input.repeatRate !== null && input.repeatRate >= 0.5) {
    goodNote = 'リピートしてくださるお客様が多く、信頼関係が築けています。'
  } else if (input.nominationRate !== null && input.nominationRate >= 0.4) {
    goodNote = '指名でのご来店が多く、安定した接客ができています。'
  } else if (input.avgSpend !== null && input.avgSpend > 0) {
    goodNote = '丁寧な接客がお客様に伝わっています。'
  }

  let improvementNote = '引き続き、丁寧な接客を続けていきましょう。'
  if (input.repeatRate !== null && input.repeatRate < 0.3) {
    improvementNote = '次回のご来店につながるお声掛けを少し増やしてみましょう。'
  } else if (input.nominationRate !== null && input.nominationRate < 0.2) {
    improvementNote = 'お客様に指名していただけるよう、接客の中で自己紹介や会話を意識してみましょう。'
  } else if (input.growthRate !== null && input.growthRate < 0) {
    improvementNote = '来月に向けて、リピートのお声掛けを意識してみましょう。'
  }

  return { goodNote, improvementNote }
}
