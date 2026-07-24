import { describe, expect, it } from 'vitest';
import {
  buildCustomerTagVocabulary,
  buildProductCategoryVocabulary,
  deriveHintsFromMatchedKeywords,
  buildMatchReasons,
  GENERAL_HINTS,
} from '../../../src/lib/nextAction/knowledgeMatch';

describe('buildCustomerTagVocabulary', () => {
  it('skinTagsを日本語ラベルへ変換する', () => {
    expect(buildCustomerTagVocabulary(['dry', 'pore'])).toEqual(['乾燥', '毛穴']);
  });

  it('insightTagsから追加の候補語を導出する(aging_concernは3語に展開)', () => {
    const result = buildCustomerTagVocabulary([], ['aging_concern']);
    expect(result).toEqual(['エイジング', 'くすみ', 'ハリ不足']);
  });

  it('skinTagsとinsightTagsの結果を重複なく統合する', () => {
    const result = buildCustomerTagVocabulary(['dry'], ['dryness_concern']);
    expect(result).toEqual(['乾燥']);
  });

  it('未知のキーは無視する', () => {
    expect(buildCustomerTagVocabulary(['unknown_tag'])).toEqual([]);
  });
});

describe('buildProductCategoryVocabulary', () => {
  it('商品名から既存のhomecareConversationHints.tsのカテゴリ判定を流用する', () => {
    expect(buildProductCategoryVocabulary(['保湿クリームA'])).toEqual(['クリーム系']);
  });

  it('該当カテゴリが無い商品(一般)は候補に含めない', () => {
    expect(buildProductCategoryVocabulary(['謎の美容グッズ'])).toEqual([]);
  });

  it('重複を統合する', () => {
    expect(buildProductCategoryVocabulary(['UVクリームA', 'UVミルクB'])).toEqual(['UVケア系']);
  });
});

describe('deriveHintsFromMatchedKeywords', () => {
  it('一致キーワードが無い場合はGENERAL_HINTSを返す', () => {
    expect(deriveHintsFromMatchedKeywords([])).toEqual(GENERAL_HINTS);
  });

  it('未知のキーワードのみの場合もGENERAL_HINTSにフォールバックする', () => {
    expect(deriveHintsFromMatchedKeywords(['未登録語'])).toEqual(GENERAL_HINTS);
  });

  it('一致したキーワードのテンプレートから最大maxCount件を返す', () => {
    const result = deriveHintsFromMatchedKeywords(['乾燥'], 1);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatch(/乾燥|保湿/);
  });

  it('複数キーワードの一致分を重複なく積み上げる', () => {
    const result = deriveHintsFromMatchedKeywords(['乾燥', '毛穴'], 3);
    expect(result.length).toBeGreaterThan(0);
    expect(new Set(result).size).toBe(result.length);
  });
});

describe('buildMatchReasons — PHASE2-C追加確認2/3: {type,score,label,source}構造への移行', () => {
  it('何も一致しない場合は空配列を返す', () => {
    expect(buildMatchReasons({})).toEqual([]);
  });

  it('一致したタグごとに{type:"skin_tag_match",score,label:"◯◯タグ一致",source:タグ名}を返す', () => {
    const reasons = buildMatchReasons({ matchedTagKeywords: ['乾燥', '毛穴'] });
    expect(reasons).toEqual([
      { type: 'skin_tag_match', score: expect.any(Number), label: '乾燥タグ一致', source: '乾燥' },
      { type: 'skin_tag_match', score: expect.any(Number), label: '毛穴タグ一致', source: '毛穴' },
    ]);
  });

  it('一致したカテゴリごとに{type:"category_match",label:"◯◯カテゴリ一致",source:カテゴリ名}を返す', () => {
    const reasons = buildMatchReasons({ matchedCategories: ['美容液系'] });
    expect(reasons).toEqual([
      { type: 'category_match', score: expect.any(Number), label: '美容液系カテゴリ一致', source: '美容液系' },
    ]);
  });

  it('関連記事一致のsourceはbrain_blog_articles(テーブル名のみ・記事の内容は含まない)', () => {
    const reasons = buildMatchReasons({ hasRelatedArticleByProduct: true });
    expect(reasons).toEqual([
      { type: 'related_article_match', score: expect.any(Number), label: '関連記事一致', source: 'brain_blog_articles' },
    ]);
  });

  it('タグ・カテゴリ・その他シグナルを組み合わせて返す(記事タイトル・summary等は含まれない)', () => {
    const reasons = buildMatchReasons({
      matchedTagKeywords: ['乾燥'],
      matchedCategories: ['美容液系'],
      hasRelatedArticleByProduct: true,
      hasHomecareProduct: true,
      hasRecentVisit: true,
      hasRecentPurchase: true,
    });
    expect(reasons.map(r => r.label)).toEqual([
      '乾燥タグ一致',
      '美容液系カテゴリ一致',
      '関連記事一致',
      'ホームケア商品一致',
      '前回施術一致',
      '購入履歴一致',
    ]);
    expect(reasons.map(r => r.type)).toEqual([
      'skin_tag_match',
      'category_match',
      'related_article_match',
      'homecare_product_match',
      'recent_visit_match',
      'purchase_history_match',
    ]);
    expect(reasons.map(r => r.source)).toEqual([
      '乾燥',
      '美容液系',
      'brain_blog_articles',
      'homecare_products',
      'brain_visits',
      'customer_action_logs',
    ]);
    // scoreは常に数値(内部利用のみ・画面表示には使わない)
    for (const r of reasons) expect(typeof r.score).toBe('number');
    // sourceに記事タイトル・本文・summary・URLが紛れ込んでいないことを確認
    for (const r of reasons) {
      expect(r.source).not.toMatch(/https?:\/\//);
      expect(r.source?.length ?? 0).toBeLessThan(30);
    }
  });

  it('falseのシグナルは含めない', () => {
    const reasons = buildMatchReasons({
      hasRelatedArticleByProduct: false,
      hasHomecareProduct: false,
      hasRecentVisit: false,
      hasRecentPurchase: false,
    });
    expect(reasons).toEqual([]);
  });
});
