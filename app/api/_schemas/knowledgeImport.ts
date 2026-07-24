import { z } from 'zod';

/** POST /api/admin/knowledge-import/preview の入力。CSVテキストをそのまま渡す。 */
export const knowledgeImportPreviewBodySchema = z.object({
  csvText: z.string().min(1, 'csvText is required'),
});

/**
 * プレビューで検証済みの1行分の入力(KNOWLEDGE_IMPORT_PHASE1)。
 * LLM・外部API連携は行わない。CSVの内容をそのまま受け取るだけ。
 */
export const knowledgeImportRowSchema = z.object({
  title: z.string().trim().min(1, 'title is required'),
  sourceUrl: z.string().trim().url('invalid url'),
  category: z.string().trim().min(1).nullable().optional(),
  keywords: z.array(z.string().trim().min(1)).default([]),
  summary: z.string().trim().min(1, 'summary is required'),
  publishedAt: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid published_date')
    .nullable()
    .optional(),
});

/** POST /api/admin/knowledge-import/commit の入力。 */
export const knowledgeImportCommitBodySchema = z.object({
  rows: z.array(knowledgeImportRowSchema).min(1, 'rows is required'),
});

/**
 * PATCH /api/admin/knowledge-import/[id] の入力。
 * isCustomerSafe/status(承認ワークフロー)はこの画面のスコープ外のため受け取らない。
 */
export const knowledgeImportUpdateBodySchema = z.object({
  title: z.string().trim().min(1).optional(),
  sourceUrl: z.string().trim().url('invalid url').optional(),
  category: z.string().trim().min(1).nullable().optional(),
  keywords: z.array(z.string().trim().min(1)).optional(),
  summary: z.string().trim().min(1).optional(),
  publishedAt: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid published_date')
    .nullable()
    .optional(),
});
