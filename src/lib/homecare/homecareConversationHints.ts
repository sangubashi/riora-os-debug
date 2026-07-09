/**
 * homecareConversationHints.ts — ホームケア商品「接客ヒント」(PHASE HC-7)
 *
 * 商品名から簡易カテゴリを判定し、接客時にスタッフが聞くと良い質問例を返す。
 * AI呼び出し・DB参照は一切行わない、完全ルールベースの静的辞書。
 *
 * 厳守事項（PHASE HC-7要件）:
 *   - 事実ベースのみ。効果を断定する文言は含めない
 *   - 購入促進文言（おすすめです等）は含めない
 *   - 「そろそろ無くなる」等の予測・残量に関する文言は含めない
 *   - あくまで「スタッフが顧客に聞く質問」の例示に留める（LINE送信文面ではない）
 */

export interface ConversationHintResult {
  category: string
  hints:    string[]
}

const GENERAL_HINTS: string[] = [
  '使い心地を確認する',
  '継続できているか聞く',
  '変化を感じているか確認する',
]

interface CategoryRule {
  category: string
  keywords: string[]
  hints:    string[]
}

// キーワードは判定の優先順（"UVクリーム"のように複数語を含む商品名があるため、
// より具体的なキーワードを先に判定する）
const CATEGORY_RULES: CategoryRule[] = [
  {
    category: 'UVケア系',
    keywords: ['UV'],
    hints: [
      '塗り直しの習慣があるか確認する',
      '日中の使用感を確認する',
      '継続できているか聞く',
    ],
  },
  {
    category: 'サプリ系',
    keywords: ['サプリ'],
    hints: [
      '飲み忘れがないか確認する',
      '継続できているか聞く',
      '体調の変化を感じているか確認する',
    ],
  },
  {
    category: '洗顔系',
    keywords: ['洗顔'],
    hints: [
      '朝晩使えているか確認する',
      'つっぱり感はないか聞く',
      '泡立ちに問題はないか確認する',
    ],
  },
  {
    category: 'クレンジング系',
    keywords: ['クレンジング'],
    hints: [
      'メイクが落としきれているか確認する',
      '目元・口元の使用感を聞く',
      '使用後につっぱらないか確認する',
    ],
  },
  {
    category: 'シートマスク系',
    keywords: ['マスク'],
    hints: [
      '使用頻度を確認する',
      'パックの時間を守れているか聞く',
      '使用後の肌の様子を聞く',
    ],
  },
  {
    category: 'アンプル・ミスト系',
    keywords: ['ミスト', 'アンプル'],
    hints: [
      '使用頻度を確認する',
      '持ち歩いて使えているか聞く',
      '継続できているか聞く',
    ],
  },
  {
    category: 'まつ毛美容液系',
    keywords: ['ラッシュ'],
    hints: [
      '毎日続けられているか確認する',
      '塗布のタイミングを聞く',
      '継続できているか聞く',
    ],
  },
  {
    category: '美容液系',
    keywords: ['セラム', 'エッセンス'],
    hints: [
      '肌変化を感じているか確認する',
      '使用頻度を確認する',
      '使い心地を聞く',
      '継続できているか聞く',
    ],
  },
  {
    category: '化粧水系',
    keywords: ['ローション'],
    hints: [
      '使い心地を確認する',
      '肌へのなじみ具合を聞く',
      '継続できているか聞く',
    ],
  },
  {
    category: 'クリーム系',
    keywords: ['クリーム'],
    hints: [
      'べたつき等の使用感を確認する',
      '保湿の満足度を聞く',
      '継続できているか聞く',
    ],
  },
]

export function getConversationHints(productName: string): ConversationHintResult {
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some(k => productName.includes(k))) {
      return { category: rule.category, hints: rule.hints }
    }
  }
  return { category: '一般', hints: GENERAL_HINTS }
}
