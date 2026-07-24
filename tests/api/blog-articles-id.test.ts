import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH, DELETE } from '../../app/api/admin/blog-articles/[id]/route';
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
  products: [],
  keywords: ['毛穴'],
  isCustomerSafe: true,
  status: 'approved',
  publishedAt: null,
  createdAt: '2026-07-01T00:00:00Z',
  category: null,
  summary: null,
};

const mockRepos = {
  blogArticleRepo: { update: vi.fn(), delete: vi.fn() },
};

function buildPatchReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/admin/blog-articles/article-1', {
    method: 'PATCH',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function buildDeleteReq(): NextRequest {
  return new NextRequest('http://localhost/api/admin/blog-articles/article-1', { method: 'DELETE' });
}

const params = Promise.resolve({ id: 'article-1' });

describe('PATCH/DELETE /api/admin/blog-articles/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRepos).mockReturnValue(mockRepos as never);
    vi.mocked(extractStaffFromRequest).mockResolvedValue(ADMIN_STAFF as never);
  });

  describe('PATCH', () => {
    it('通常の編集フィールドをそのままupdate()へ渡す', async () => {
      mockRepos.blogArticleRepo.update.mockResolvedValue(ARTICLE);

      await PATCH(buildPatchReq({ title: '新タイトル' }), { params });

      expect(mockRepos.blogArticleRepo.update).toHaveBeenCalledWith('article-1', { title: '新タイトル' });
    });

    it('isCustomerSafe=trueが送られた場合はstatus=approvedを連動させる', async () => {
      mockRepos.blogArticleRepo.update.mockResolvedValue(ARTICLE);

      await PATCH(buildPatchReq({ isCustomerSafe: true }), { params });

      expect(mockRepos.blogArticleRepo.update).toHaveBeenCalledWith('article-1', {
        isCustomerSafe: true, status: 'approved',
      });
    });

    it('isCustomerSafe=falseが送られた場合はstatus=draftを連動させる', async () => {
      mockRepos.blogArticleRepo.update.mockResolvedValue(ARTICLE);

      await PATCH(buildPatchReq({ isCustomerSafe: false }), { params });

      expect(mockRepos.blogArticleRepo.update).toHaveBeenCalledWith('article-1', {
        isCustomerSafe: false, status: 'draft',
      });
    });

    it('対象記事が存在しない場合は404を返す', async () => {
      mockRepos.blogArticleRepo.update.mockResolvedValue(null);

      const res = await PATCH(buildPatchReq({ title: 'X' }), { params });
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body).toEqual({ success: false, error: 'article_not_found' });
    });

    it('不正なsourceUrlの場合は400(validation_error)を返す', async () => {
      const res = await PATCH(buildPatchReq({ sourceUrl: 'not-a-url' }), { params });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe('validation_error');
    });

    it('未認証(admin以外)の場合は403を返す', async () => {
      vi.mocked(extractStaffFromRequest).mockResolvedValue({
        authUserId: 'staff-uid', staffBrainId: 'staff-id', email: 'staff@example.com', isAdmin: false,
      } as never);

      const res = await PATCH(buildPatchReq({ title: 'X' }), { params });

      expect(res.status).toBe(403);
    });
  });

  describe('DELETE', () => {
    it('削除成功時はsuccess:trueを返す', async () => {
      mockRepos.blogArticleRepo.delete.mockResolvedValue(true);

      const res = await DELETE(buildDeleteReq(), { params });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({ success: true });
    });

    it('対象記事が存在しない場合は404を返す', async () => {
      mockRepos.blogArticleRepo.delete.mockResolvedValue(false);

      const res = await DELETE(buildDeleteReq(), { params });
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body).toEqual({ success: false, error: 'article_not_found' });
    });

    it('Repositoryが例外をthrowした場合は500を返す', async () => {
      mockRepos.blogArticleRepo.delete.mockRejectedValue(new Error('db down'));

      const res = await DELETE(buildDeleteReq(), { params });

      expect(res.status).toBe(500);
    });
  });
});
