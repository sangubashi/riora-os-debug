import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../../app/api/blog-articles/knowledge-match/route';
import { getRepos } from '../../app/lib/repos';
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest';
import type { BlogArticle } from '../../src/types/riora.types';

vi.mock('../../app/lib/repos', () => ({ getRepos: vi.fn() }));
vi.mock('@/lib/auth/extractStaffFromRequest', () => ({ extractStaffFromRequest: vi.fn() }));

const STAFF = {
  authUserId: 'staff-auth-uid', staffBrainId: 'staff-id',
  email: 'staff@example.com', isAdmin: false,
};

const KEYWORD_ARTICLE: BlogArticle = {
  id: 'article-1',
  title: '毛穴ケアの基本',
  sourceUrl: 'https://example.com/pore-care',
  products: ['クレンジングオイル'],
  keywords: ['毛穴', '脂性'],
  isCustomerSafe: true,
  status: 'approved',
  publishedAt: null,
  createdAt: '2026-07-01T00:00:00Z',
  category: 'クレンジング系',
  summary: 'これは内部メモ用の要約であり画面には出さない',
};

const CATEGORY_ARTICLE: BlogArticle = {
  ...KEYWORD_ARTICLE,
  id: 'article-2',
  keywords: [],
  category: '美容液系',
};

const mockRepos = {
  blogArticleRepo: {
    listApprovedByKeywords:   vi.fn(),
    listApprovedByCategories: vi.fn(),
  },
};

function buildReq(keywords: string[], categories: string[] = []): NextRequest {
  const params = [
    ...keywords.map((k) => `keywords=${encodeURIComponent(k)}`),
    ...categories.map((c) => `categories=${encodeURIComponent(c)}`),
  ].join('&');
  return new NextRequest(`http://localhost/api/blog-articles/knowledge-match${params ? `?${params}` : ''}`);
}

describe('GET /api/blog-articles/knowledge-match', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRepos).mockReturnValue(mockRepos as never);
    vi.mocked(extractStaffFromRequest).mockResolvedValue(STAFF as never);
    mockRepos.blogArticleRepo.listApprovedByKeywords.mockResolvedValue([]);
    mockRepos.blogArticleRepo.listApprovedByCategories.mockResolvedValue([]);
  });

  it('一般スタッフ(admin以外)でもアクセスできる', async () => {
    const res = await GET(buildReq(['毛穴']));
    expect(res.status).toBe(200);
  });

  it('渡した候補語のうち、記事のkeywordsと一致したものだけを返す(記事id/title/summary等は返さない)', async () => {
    mockRepos.blogArticleRepo.listApprovedByKeywords.mockResolvedValue([KEYWORD_ARTICLE]);

    const res = await GET(buildReq(['毛穴', '乾燥']));
    const body = await res.json();

    // KEYWORD_ARTICLE.keywordsは['毛穴','脂性']なので、候補語['毛穴','乾燥']のうち一致するのは'毛穴'のみ
    expect(body).toEqual({ success: true, matchedKeywords: ['毛穴'], matchedCategories: [] });
  });

  it('渡した候補カテゴリのうち、記事のcategoryと一致したものだけを返す', async () => {
    mockRepos.blogArticleRepo.listApprovedByCategories.mockResolvedValue([CATEGORY_ARTICLE]);

    const res = await GET(buildReq([], ['美容液系', 'クリーム系']));
    const body = await res.json();

    expect(body).toEqual({ success: true, matchedKeywords: [], matchedCategories: ['美容液系'] });
  });

  it('keywords/categoriesともに無い場合はRepositoryへ問い合わせず空配列を返す', async () => {
    const res = await GET(buildReq([]));
    const body = await res.json();

    expect(mockRepos.blogArticleRepo.listApprovedByKeywords).not.toHaveBeenCalled();
    expect(mockRepos.blogArticleRepo.listApprovedByCategories).not.toHaveBeenCalled();
    expect(body).toEqual({ success: true, matchedKeywords: [], matchedCategories: [] });
  });

  it('重複した候補語は1回に正規化してRepositoryへ渡す', async () => {
    await GET(buildReq(['毛穴', '毛穴']));

    expect(mockRepos.blogArticleRepo.listApprovedByKeywords).toHaveBeenCalledWith(['毛穴'], 5);
  });

  it('未認証の場合は401を返す', async () => {
    vi.mocked(extractStaffFromRequest).mockResolvedValue(null);

    const res = await GET(buildReq(['毛穴']));

    expect(res.status).toBe(401);
  });

  it('Repositoryが例外をthrowした場合は500を返す', async () => {
    mockRepos.blogArticleRepo.listApprovedByKeywords.mockRejectedValue(new Error('db down'));

    const res = await GET(buildReq(['毛穴']));

    expect(res.status).toBe(500);
  });
});
