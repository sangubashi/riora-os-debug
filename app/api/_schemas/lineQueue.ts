import { z } from 'zod';

/** ApproveLineSend(POST /api/line-queue/[id]/approve)の入力検証スキーマ。 */
export const updateLineQueueStatusSchema = z.object({
  status: z.enum(['pending', 'approved', 'sent', 'rejected']),
});

export type UpdateLineQueueStatusPayload = z.infer<typeof updateLineQueueStatusSchema>;
