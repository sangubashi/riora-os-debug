// ================================================================
// buildMenuAIContext 検証
//
// メニュー情報のうちAIへ渡してよい6項目(ai_tags/カテゴリ/価格帯/施術時間/
// 禁忌/おすすめ頻度)だけを抽出する許可リスト方式の純粋関数を検証する。
// name/skinConcernTags/expectedEffects/recommendedHomecareProducts/生のprice
// が結果に一切含まれないことを確認する(PHASE MENU-AI-1・ユーザー指示④)。
// ================================================================
import { describe, expect, it } from 'vitest';
import { buildMenuAIContext, toPriceBand, formatMenuAIContextBlock } from '../../../src/lib/menu/buildMenuAIContext';
import type { Menu } from '../../../src/types/riora.types';

function menu(overrides: Partial<Menu> = {}): Menu {
  return {
    id: 'm1', storeId: 'store-1', name: 'ハーブピーリング60分（長文の説明文が入る想定）',
    price: 12000, role: 'peeling', targetTypes: [],
    durationMinutes: 60,
    skinConcernTags: ['毛穴', 'くすみ'],
    expectedEffects: ['毛穴引き締め'],
    recommendedCycleDays: 28,
    contraindicationTags: ['妊娠中', '強い日焼け直後'],
    recommendedHomecareProducts: ['ビタミンC美容液'],
    aiTags: ['毛穴', 'くすみ', 'ピーリング'],
    ...overrides,
  };
}

describe('toPriceBand', () => {
  it('5,000円刻みの{min,max}帯に丸める', () => {
    expect(toPriceBand(12000)).toEqual({ min: 10000, max: 15000 });
    expect(toPriceBand(10000)).toEqual({ min: 10000, max: 15000 });
    expect(toPriceBand(4999)).toEqual({ min: 0, max: 5000 });
    expect(toPriceBand(0)).toEqual({ min: 0, max: 5000 });
  });
});

describe('buildMenuAIContext', () => {
  it('許可リストの6項目のみを返す(name/skinConcernTags/expectedEffects/recommendedHomecareProducts/生のpriceは含めない)', () => {
    const context = buildMenuAIContext(menu());

    expect(context).toEqual({
      aiTags: ['毛穴', 'くすみ', 'ピーリング'],
      category: 'peeling',
      priceBand: { min: 10000, max: 15000 },
      durationMinutes: 60,
      contraindicationTags: ['妊娠中', '強い日焼け直後'],
      recommendedCycleDays: 28,
    });

    // 許可リスト外のフィールド名がキーとして一切含まれないことを明示的に確認する
    expect(Object.keys(context).sort()).toEqual(
      ['aiTags', 'category', 'contraindicationTags', 'durationMinutes', 'priceBand', 'recommendedCycleDays'].sort()
    );
    expect(context).not.toHaveProperty('name');
    expect(context).not.toHaveProperty('price');
    expect(context).not.toHaveProperty('skinConcernTags');
    expect(context).not.toHaveProperty('expectedEffects');
    expect(context).not.toHaveProperty('recommendedHomecareProducts');
  });

  it('未入力(optional未設定)のメニューは空配列・nullで安全に返す(架空データを作らない)', () => {
    const bareMenu: Menu = { id: 'm2', storeId: 'store-1', name: 'ベーシックコース', price: 8000, role: 'entry', targetTypes: [] };
    const context = buildMenuAIContext(bareMenu);

    expect(context).toEqual({
      aiTags: [],
      category: 'entry',
      priceBand: { min: 5000, max: 10000 },
      durationMinutes: null,
      contraindicationTags: [],
      recommendedCycleDays: null,
    });
  });
});

describe('formatMenuAIContextBlock', () => {
  it('値が入っている項目のみ行として出す(PHASE MENU-AI-3)', () => {
    const block = formatMenuAIContextBlock(buildMenuAIContext(menu()));

    expect(block).toBe([
      'Menu AI Context',
      '- category: peeling',
      '- aiTags: 毛穴・くすみ・ピーリング',
      '- durationMinutes: 60分',
      '- recommendedCycleDays: 28日',
      '- contraindicationTags: 妊娠中・強い日焼け直後',
      '- priceBand: ¥10,000〜¥15,000',
    ].join('\n'));
  });

  it('未入力項目(空配列・null)は行を出さない(架空の穴埋め文言を作らない)', () => {
    const bareMenu: Menu = { id: 'm2', storeId: 'store-1', name: 'ベーシックコース', price: 8000, role: 'entry', targetTypes: [] };
    const block = formatMenuAIContextBlock(buildMenuAIContext(bareMenu));

    expect(block).toBe([
      'Menu AI Context',
      '- category: entry',
      '- priceBand: ¥5,000〜¥10,000',
    ].join('\n'));
  });
});
