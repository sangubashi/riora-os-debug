import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../../app/api/blog-articles/related/route';
import { getRepos } from '../../app/lib/repos';
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest';
import type { BlogArticle } from '../../src/types/riora.types';

vi.mock('../../app/lib/repos', () => ({ getRepos: vi.fn() }));
vi.mock('@/lib/auth/extractStaffFromRequest', () => ({ extractStaffFromRequest: vi.fn() }));

const STAFF = {
  authUserId: 'staff-auth-uid', staffBrainId: 'staff-id',
  email: 'staff@example.com', isAdmin: false,
};

const ARTICLE: BlogArticle = {
  id: 'article-1',
  title: '毛穴ケアの基本',
  sourceUrl: 'https://example.com/pore-care',
  products: ['クレンジングオイル'],
  keywords: ['毛穴'],
  isCustomerSafe: true,
  status: 'approved',
  publishedAt: null,
  createdAt: '2026-07-01T00:00:00Z',
  category: null,
  summary: 'これは内部メモ用の要約であり画面には出さない',
};

const mockRepos = {
  blogArticleRepo: { listApprovedByProducts: vi.fn() },
};

function buildReq(products: string[]): NextRequest {
  const params = products.map((p) => `products=${encodeURIComponent(p)}`).join('&');
  return new NextRequest(`http://localhost/api/blog-articles/related${params ? `?${params}` : ''}`);
}

describe('GET /api/blog-articles/related', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRepos).mockReturnValue(mockRepos as never);
    vi.mocked(extractStaffFromRequest).mockResolvedValue(STAFF as never);
  });

  it('一般スタッフ(admin以外)でもアクセスできる', async () => {
    mockRepos.blogArticleRepo.listApprovedByProducts.mockResolvedValue([ARTICLE]);

    const res = await GET(buildReq(['クレンジングオイル']));

    expect(res.status).toBe(200);
  });

  it('idとtitleのみを返す(source_url/summary/keywords等は返さない)', async () => {
    mockRepos.blogArticleRepo.listApprovedByProducts.mockResolvedValue([ARTICLE]);

    const res = await GET(buildReq(['クレンジングオイル']));
    const body = await res.json();

    expect(body).toEqual({ success: true, articles: [{ id: 'article-1', title: '毛穴ケアの基本' }] });
  });

  it('最大3件になるようRepositoryへlimit=3を渡す', async () => {
    mockRepos.blogArticleRepo.listApprovedByProducts.mockResolvedValue([]);

    await GET(buildReq(['クレンジングオイル']));

    expect(mockRepos.blogArticleRepo.listApprovedByProducts).toHaveBeenCalledWith(['クレンジングオイル'], 3);
  });

  it('productsクエリが無い場合は空配列をRepositoryへ渡す', async () => {
    mockRepos.blogArticleRepo.listApprovedByProducts.mockResolvedValue([]);

    await GET(buildReq([]));

    expect(mockRepos.blogArticleRepo.listApprovedByProducts).toHaveBeenCalledWith([], 3);
  });

  it('未認証の場合は401を返す', async () => {
    vi.mocked(extractStaffFromRequest).mockResolvedValue(null);

    const res = await GET(buildReq(['A']));

    expect(res.status).toBe(401);
  });

  it('Repositoryが例外をthrowした場合は500を返す', async () => {
    mockRepos.blogArticleRepo.listApprovedByProducts.mockRejectedValue(new Error('db down'));

    const res = await GET(buildReq(['A']));

    expect(res.status).toBe(500);
  });
});
