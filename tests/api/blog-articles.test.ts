import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '../../app/api/admin/blog-articles/route';
import { getRepos } from '../../app/lib/repos';
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest';
import type { BlogArticle } from '../../src/types/riora.types';

vi.mock('../../app/lib/repos', () => ({ getRepos: vi.fn() }));
vi.mock('@/lib/auth/extractStaffFromRequest', () => ({ extractStaffFromRequest: vi.fn() }));

const ADMIN_STAFF = {
  authUserId: 'admin-auth-uid', staffBrainId: 'admin-staff-id',
  email: 'admin@salon-riora.jp', isAdmin: true,
};

const ARTICLE: BlogArticle = {
  id: 'article-1',
  title: '毛穴ケアの基本',
  sourceUrl: 'https://example.com/pore-care',
  products: ['クレンジングオイル'],
  keywords: ['毛穴'],
  isCustomerSafe: false,
  status: 'draft',
  publishedAt: null,
  createdAt: '2026-07-01T00:00:00Z',
  category: null,
  summary: null,
};

const mockRepos = {
  blogArticleRepo: { listAll: vi.fn(), create: vi.fn() },
};

function buildGetReq(): NextRequest {
  return new NextRequest('http://localhost/api/admin/blog-articles');
}

function buildPostReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/admin/blog-articles', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('GET/POST /api/admin/blog-articles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRepos).mockReturnValue(mockRepos as never);
    vi.mocked(extractStaffFromRequest).mockResolvedValue(ADMIN_STAFF as never);
  });

  describe('GET', () => {
    it('記事一覧を返す', async () => {
      mockRepos.blogArticleRepo.listAll.mockResolvedValue([ARTICLE]);

      const res = await GET(buildGetReq());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({ success: true, articles: [ARTICLE] });
    });

    it('未認証(admin以外)の場合は403を返す', async () => {
      vi.mocked(extractStaffFromRequest).mockResolvedValue({
        authUserId: 'staff-uid', staffBrainId: 'staff-id', email: 'staff@example.com', isAdmin: false,
      } as never);

      const res = await GET(buildGetReq());

      expect(res.status).toBe(403);
    });

    it('Repository factoryがエラーの場合は500を返す', async () => {
      vi.mocked(getRepos).mockImplementation(() => { throw new Error('Supabase env not configured'); });

      const res = await GET(buildGetReq());

      expect(res.status).toBe(500);
    });
  });

  describe('POST', () => {
    it('記事を新規作成する', async () => {
      mockRepos.blogArticleRepo.create.mockResolvedValue(ARTICLE);

      const res = await POST(buildPostReq({
        title: '毛穴ケアの基本', sourceUrl: 'https://example.com/pore-care',
        products: ['クレンジングオイル'], keywords: ['毛穴'],
      }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({ success: true, article: ARTICLE });
    });

    it('必須フィールド(title)が欠落している場合は400(validation_error)を返す', async () => {
      const res = await POST(buildPostReq({ sourceUrl: 'https://example.com' }));
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe('validation_error');
    });

    it('sourceUrlが不正なURLの場合は400(validation_error)を返す', async () => {
      const res = await POST(buildPostReq({ title: 'T', sourceUrl: 'not-a-url' }));
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe('validation_error');
    });

    it('不正なJSONの場合は400を返す', async () => {
      const res = await POST(buildPostReq('not-json'));
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body).toEqual({ success: false, error: 'invalid_json' });
    });

    it('Repositoryが例外をthrowした場合は500を返す', async () => {
      mockRepos.blogArticleRepo.create.mockRejectedValue(new Error('db down'));

      const res = await POST(buildPostReq({ title: 'T', sourceUrl: 'https://example.com' }));

      expect(res.status).toBe(500);
    });
  });
});
