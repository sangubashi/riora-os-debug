import { describe, expect, it } from 'vitest';
import { BlogArticleRepo } from '../../../src/repositories/supabase/BlogArticleRepo';
import { createSingleTableSupabaseMock, createSupabaseMock, createQueryBuilderMock } from './testUtils';
import type { BrainBlogArticleRow } from '../../../src/repositories/supabase/mappers';

const ARTICLE_ROW: BrainBlogArticleRow = {
  id: 'article-1',
  title: '毛穴ケアの基本',
  source_url: 'https://example.com/pore-care',
  products: ['クレンジングオイル'],
  keywords: ['毛穴', '皮脂'],
  is_customer_safe: true,
  status: 'approved',
  published_at: '2026-07-01',
  created_at: '2026-07-01T00:00:00Z',
  category: 'クレンジング系',
  summary: '毛穴の黒ずみケアについての基礎知識。',
};

const ARTICLE_DOMAIN = {
  id: 'article-1',
  title: '毛穴ケアの基本',
  sourceUrl: 'https://example.com/pore-care',
  products: ['クレンジングオイル'],
  keywords: ['毛穴', '皮脂'],
  isCustomerSafe: true,
  status: 'approved' as const,
  publishedAt: '2026-07-01',
  createdAt: '2026-07-01T00:00:00Z',
  category: 'クレンジング系',
  summary: '毛穴の黒ずみケアについての基礎知識。',
};

describe('BlogArticleRepo', () => {
  describe('listAll', () => {
    it('created_at降順で全件をBlogArticle[]へ変換して返す', async () => {
      const { client } = createSingleTableSupabaseMock({ data: [ARTICLE_ROW], error: null });
      const repo = new BlogArticleRepo(client);

      const result = await repo.listAll();

      expect(result).toEqual([ARTICLE_DOMAIN]);
    });

    it('created_at降順でorderする', async () => {
      const builder = createQueryBuilderMock({ data: [], error: null });
      const client = createSupabaseMock(() => builder);
      const repo = new BlogArticleRepo(client);

      await repo.listAll();

      expect(builder.order).toHaveBeenCalledWith('created_at', { ascending: false });
    });

    it('Supabaseがerrorを返した場合はBlogArticleRepo.listAll failedで例外を投げる', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: { message: 'db down' } });
      const repo = new BlogArticleRepo(client);

      await expect(repo.listAll()).rejects.toThrow('BlogArticleRepo.listAll failed: db down');
    });
  });

  describe('listApprovedByProducts', () => {
    it('productNamesが空配列の場合は無条件に空配列を返す(DBへ問い合わせない)', async () => {
      const builder = createQueryBuilderMock({ data: [ARTICLE_ROW], error: null });
      const client = createSupabaseMock(() => builder);
      const repo = new BlogArticleRepo(client);

      const result = await repo.listApprovedByProducts([], 3);

      expect(result).toEqual([]);
      expect(client.from).not.toHaveBeenCalled();
    });

    it('is_customer_safe=true・status=approved・productsのoverlapsで絞り込む', async () => {
      const builder = createQueryBuilderMock({ data: [ARTICLE_ROW], error: null });
      const client = createSupabaseMock(() => builder);
      const repo = new BlogArticleRepo(client);

      const result = await repo.listApprovedByProducts(['クレンジングオイル'], 3);

      expect(builder.eq).toHaveBeenCalledWith('is_customer_safe', true);
      expect(builder.eq).toHaveBeenCalledWith('status', 'approved');
      expect(builder.overlaps).toHaveBeenCalledWith('products', ['クレンジングオイル']);
      expect(builder.limit).toHaveBeenCalledWith(3);
      expect(result).toEqual([ARTICLE_DOMAIN]);
    });

    it('Supabaseがerrorを返した場合はBlogArticleRepo.listApprovedByProducts failedで例外を投げる', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: { message: 'db down' } });
      const repo = new BlogArticleRepo(client);

      await expect(repo.listApprovedByProducts(['A'], 3)).rejects.toThrow(
        'BlogArticleRepo.listApprovedByProducts failed: db down'
      );
    });
  });

  describe('listApprovedByKeywords', () => {
    it('keywordsが空配列の場合は無条件に空配列を返す(DBへ問い合わせない)', async () => {
      const builder = createQueryBuilderMock({ data: [ARTICLE_ROW], error: null });
      const client = createSupabaseMock(() => builder);
      const repo = new BlogArticleRepo(client);

      const result = await repo.listApprovedByKeywords([], 5);

      expect(result).toEqual([]);
      expect(client.from).not.toHaveBeenCalled();
    });

    it('is_customer_safe=true・status=approved・keywordsのoverlapsで絞り込む', async () => {
      const builder = createQueryBuilderMock({ data: [ARTICLE_ROW], error: null });
      const client = createSupabaseMock(() => builder);
      const repo = new BlogArticleRepo(client);

      const result = await repo.listApprovedByKeywords(['毛穴', '皮脂'], 5);

      expect(builder.eq).toHaveBeenCalledWith('is_customer_safe', true);
      expect(builder.eq).toHaveBeenCalledWith('status', 'approved');
      expect(builder.overlaps).toHaveBeenCalledWith('keywords', ['毛穴', '皮脂']);
      expect(builder.limit).toHaveBeenCalledWith(5);
      expect(result).toEqual([ARTICLE_DOMAIN]);
    });

    it('Supabaseがerrorを返した場合はBlogArticleRepo.listApprovedByKeywords failedで例外を投げる', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: { message: 'db down' } });
      const repo = new BlogArticleRepo(client);

      await expect(repo.listApprovedByKeywords(['毛穴'], 5)).rejects.toThrow(
        'BlogArticleRepo.listApprovedByKeywords failed: db down'
      );
    });
  });

  describe('listApprovedByCategories', () => {
    it('categoriesが空配列の場合は無条件に空配列を返す(DBへ問い合わせない)', async () => {
      const builder = createQueryBuilderMock({ data: [ARTICLE_ROW], error: null });
      const client = createSupabaseMock(() => builder);
      const repo = new BlogArticleRepo(client);

      const result = await repo.listApprovedByCategories([], 5);

      expect(result).toEqual([]);
      expect(client.from).not.toHaveBeenCalled();
    });

    it('is_customer_safe=true・status=approved・categoryのinで絞り込む', async () => {
      const builder = createQueryBuilderMock({ data: [ARTICLE_ROW], error: null });
      const client = createSupabaseMock(() => builder);
      const repo = new BlogArticleRepo(client);

      const result = await repo.listApprovedByCategories(['クレンジング系'], 5);

      expect(builder.eq).toHaveBeenCalledWith('is_customer_safe', true);
      expect(builder.eq).toHaveBeenCalledWith('status', 'approved');
      expect(builder.in).toHaveBeenCalledWith('category', ['クレンジング系']);
      expect(builder.limit).toHaveBeenCalledWith(5);
      expect(result).toEqual([ARTICLE_DOMAIN]);
    });

    it('Supabaseがerrorを返した場合はBlogArticleRepo.listApprovedByCategories failedで例外を投げる', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: { message: 'db down' } });
      const repo = new BlogArticleRepo(client);

      await expect(repo.listApprovedByCategories(['クレンジング系'], 5)).rejects.toThrow(
        'BlogArticleRepo.listApprovedByCategories failed: db down'
      );
    });
  });

  describe('create', () => {
    it('新規記事を作成しBlogArticleへ変換して返す', async () => {
      const { client } = createSingleTableSupabaseMock({ data: ARTICLE_ROW, error: null });
      const repo = new BlogArticleRepo(client);

      const result = await repo.create({
        title: '毛穴ケアの基本',
        sourceUrl: 'https://example.com/pore-care',
        products: ['クレンジングオイル'],
        keywords: ['毛穴', '皮脂'],
      });

      expect(result).toEqual(ARTICLE_DOMAIN);
    });

    it('category/summary/publishedAt省略時はnullを渡す', async () => {
      const builder = createQueryBuilderMock({ data: ARTICLE_ROW, error: null });
      const client = createSupabaseMock(() => builder);
      const repo = new BlogArticleRepo(client);

      await repo.create({ title: 'T', sourceUrl: 'https://example.com', products: [], keywords: [] });

      expect(builder.insert).toHaveBeenCalledWith(
        expect.objectContaining({ category: null, summary: null, published_at: null })
      );
    });

    it('Supabaseがerrorを返した場合はBlogArticleRepo.create failedで例外を投げる', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: { message: 'insert failed' } });
      const repo = new BlogArticleRepo(client);

      await expect(
        repo.create({ title: 'T', sourceUrl: 'https://example.com', products: [], keywords: [] })
      ).rejects.toThrow('BlogArticleRepo.create failed: insert failed');
    });
  });

  describe('update', () => {
    it('指定したフィールドのみpatchに含める', async () => {
      const builder = createQueryBuilderMock({ data: ARTICLE_ROW, error: null });
      const client = createSupabaseMock(() => builder);
      const repo = new BlogArticleRepo(client);

      await repo.update('article-1', { isCustomerSafe: true, status: 'approved' });

      expect(builder.update).toHaveBeenCalledWith({ is_customer_safe: true, status: 'approved' });
    });

    it('対象idが存在しない場合はnullを返す', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: null });
      const repo = new BlogArticleRepo(client);

      const result = await repo.update('missing', { title: 'X' });

      expect(result).toBeNull();
    });

    it('Supabaseがerrorを返した場合はBlogArticleRepo.update failedで例外を投げる', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: { message: 'update failed' } });
      const repo = new BlogArticleRepo(client);

      await expect(repo.update('article-1', { title: 'X' })).rejects.toThrow(
        'BlogArticleRepo.update failed: update failed'
      );
    });
  });

  describe('delete', () => {
    it('削除件数が1件以上ならtrueを返す', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: null, count: 1 });
      const repo = new BlogArticleRepo(client);

      const result = await repo.delete('article-1');

      expect(result).toBe(true);
    });

    it('削除件数が0件ならfalseを返す', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: null, count: 0 });
      const repo = new BlogArticleRepo(client);

      const result = await repo.delete('missing');

      expect(result).toBe(false);
    });

    it('Supabaseがerrorを返した場合はBlogArticleRepo.delete failedで例外を投げる', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: { message: 'delete failed' } });
      const repo = new BlogArticleRepo(client);

      await expect(repo.delete('article-1')).rejects.toThrow('BlogArticleRepo.delete failed: delete failed');
    });
  });
});
