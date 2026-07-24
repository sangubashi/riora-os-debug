import { z } from 'zod';

/** POST /api/admin/blog-articles の入力(BLOG_CONTENT_PHASE1)。記事本文は受け取らない。 */
export const createBlogArticleBodySchema = z.object({
  title: z.string().trim().min(1, 'title is required'),
  sourceUrl: z.string().trim().url('invalid url'),
  products: z.array(z.string().trim().min(1)).default([]),
  keywords: z.array(z.string().trim().min(1)).default([]),
});

/** PATCH /api/admin/blog-articles/[id] の入力。編集・承認切替の両方をこのスキーマで受ける。 */
export const updateBlogArticleBodySchema = z.object({
  title: z.string().trim().min(1).optional(),
  sourceUrl: z.string().trim().url('invalid url').optional(),
  products: z.array(z.string().trim().min(1)).optional(),
  keywords: z.array(z.string().trim().min(1)).optional(),
  isCustomerSafe: z.boolean().optional(),
});
