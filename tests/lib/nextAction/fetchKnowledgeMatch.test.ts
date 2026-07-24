import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fetchKnowledgeMatch } from '../../../src/lib/nextAction/fetchKnowledgeMatch';
import { authedFetch } from '@/lib/api/authedFetch';

vi.mock('@/lib/api/authedFetch', () => ({ authedFetch: vi.fn() }));

describe('fetchKnowledgeMatch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keywords・categoriesともに空の場合はfetchせず空を返す', async () => {
    const result = await fetchKnowledgeMatch([], []);
    expect(result).toEqual({ matchedKeywords: [], matchedCategories: [] });
    expect(authedFetch).not.toHaveBeenCalled();
  });

  it('APIのmatchedKeywords/matchedCategoriesをそのまま返す', async () => {
    vi.mocked(authedFetch).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, matchedKeywords: ['乾燥'], matchedCategories: ['美容液系'] }),
    } as never);

    const result = await fetchKnowledgeMatch(['乾燥', '毛穴'], ['美容液系']);
    expect(result).toEqual({ matchedKeywords: ['乾燥'], matchedCategories: ['美容液系'] });
  });

  it('APIが失敗した場合は空を返す(フェイルセーフ)', async () => {
    vi.mocked(authedFetch).mockResolvedValue({ ok: false } as never);
    const result = await fetchKnowledgeMatch(['乾燥'], []);
    expect(result).toEqual({ matchedKeywords: [], matchedCategories: [] });
  });

  it('fetch自体が例外を投げても空を返す', async () => {
    vi.mocked(authedFetch).mockRejectedValue(new Error('network error'));
    const result = await fetchKnowledgeMatch(['乾燥'], []);
    expect(result).toEqual({ matchedKeywords: [], matchedCategories: [] });
  });
});
