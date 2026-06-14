import { z } from 'zod';
import { idSchema } from './common';

/** ApproveRevision(POST /api/revisions/[id]/approve)の入力検証スキーマ。 */
export const approveRevisionSchema = z.object({
  scope: z.enum(['store', 'brand']),
  decidedBy: idSchema,
});

export type ApproveRevisionPayload = z.infer<typeof approveRevisionSchema>;
