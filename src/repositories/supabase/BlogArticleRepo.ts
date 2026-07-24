/**
 * BlogArticleRepo.ts — brain_blog_articles(BLOG_CONTENT_PHASE1)のRepository実装。
 *
 * 記事本文の取得・保存は行わない(URL登録のみの方針。スクレイピング禁止)。
 * 薬機法チェック・AI判定ロジックは一切持たない。is_customer_safeは呼び出し側
 * (管理画面API)から渡されたbooleanをそのまま反映するだけ。
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BlogArticle, UUID } from '../../types/riora.types';
import type { CreateBlogArticleInput, IBlogArticleRepo, UpdateBlogArticleInput } from '../interfaces';
import { toBlogArticle, type BrainBlogArticleRow } from './mappers';

const ARTICLE_COLUMNS = 'id, title, source_url, products, keywords, is_customer_safe, status, published_at, created_at, category, summary';

export class BlogArticleRepo implements IBlogArticleRepo {
  constructor(private readonly client: SupabaseClient) {}

  async listAll(): Promise<BlogArticle[]> {
    const { data, error } = await this.client
      .from('brain_blog_articles')
      .select(ARTICLE_COLUMNS)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`BlogArticleRepo.listAll failed: ${error.message}`);
    }
    return ((data ?? []) as unknown as BrainBlogArticleRow[]).map(toBlogArticle);
  }

  async listApprovedByProducts(productNames: string[], limit: number): Promise<BlogArticle[]> {
    if (productNames.length === 0) return [];

    const { data, error } = await this.client
      .from('brain_blog_articles')
      .select(ARTICLE_COLUMNS)
      .eq('is_customer_safe', true)
      .eq('status', 'approved')
      .overlaps('products', productNames)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`BlogArticleRepo.listApprovedByProducts failed: ${error.message}`);
    }
    return ((data ?? []) as unknown as BrainBlogArticleRow[]).map(toBlogArticle);
  }

  async create(input: CreateBlogArticleInput): Promise<BlogArticle> {
    const { data, error } = await this.client
      .from('brain_blog_articles')
      .insert({
        title: input.title,
        source_url: input.sourceUrl,
        products: input.products,
        keywords: input.keywords,
        category: input.category ?? null,
        summary: input.summary ?? null,
        published_at: input.publishedAt ?? null,
      })
      .select(ARTICLE_COLUMNS)
      .single();

    if (error) {
      throw new Error(`BlogArticleRepo.create failed: ${error.message}`);
    }
    return toBlogArticle(data as unknown as BrainBlogArticleRow);
  }

  async update(id: UUID, input: UpdateBlogArticleInput): Promise<BlogArticle | null> {
    const patch: Record<string, unknown> = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.sourceUrl !== undefined) patch.source_url = input.sourceUrl;
    if (input.products !== undefined) patch.products = input.products;
    if (input.keywords !== undefined) patch.keywords = input.keywords;
    if (input.isCustomerSafe !== undefined) patch.is_customer_safe = input.isCustomerSafe;
    if (input.status !== undefined) patch.status = input.status;
    if (input.category !== undefined) patch.category = input.category;
    if (input.summary !== undefined) patch.summary = input.summary;
    if (input.publishedAt !== undefined) patch.published_at = input.publishedAt;

    const { data, error } = await this.client
      .from('brain_blog_articles')
      .update(patch)
      .eq('id', id)
      .select(ARTICLE_COLUMNS)
      .maybeSingle();

    if (error) {
      throw new Error(`BlogArticleRepo.update failed: ${error.message}`);
    }
    if (!data) return null;
    return toBlogArticle(data as unknown as BrainBlogArticleRow);
  }

  async delete(id: UUID): Promise<boolean> {
    const { error, count } = await this.client
      .from('brain_blog_articles')
      .delete({ count: 'exact' })
      .eq('id', id);

    if (error) {
      throw new Error(`BlogArticleRepo.delete failed: ${error.message}`);
    }
    return (count ?? 0) > 0;
  }
}
