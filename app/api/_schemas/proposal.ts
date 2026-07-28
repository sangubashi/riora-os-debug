import { z } from 'zod';
import { idSchema } from './common';

/** GenerateProposal(GET/POST /api/admin/proposals)の入力検証スキーマ。 */
export const proposalQuerySchema = z.object({
  storeId: idSchema,
  customerId: idSchema,
  staffId: idSchema,
});

export const proposalSaveSchema = proposalQuerySchema;

/**
 * SubmitProposalFeedback(POST /api/admin/proposals/feedback)の入力検証スキーマ。
 * patternId/stepNo/proposalKindは渡さない(brain_pattern_fire_log.decision_recordに
 * 既に保存済みのため、サーバ側でその行を読んで使う。新規テーブル/カラムなしの設計)。
 */
export const proposalFeedbackSchema = z.object({
  storeId: idSchema,
  staffId: idSchema,
  fireLogId: idSchema,
  feedback: z.enum(['good', 'bad']),
});
