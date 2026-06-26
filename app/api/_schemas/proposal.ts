import { z } from 'zod';
import { idSchema } from './common';

/** GenerateProposal(GET/POST /api/admin/proposals)の入力検証スキーマ。 */
export const proposalQuerySchema = z.object({
  storeId: idSchema,
  customerId: idSchema,
  staffId: idSchema,
});

export const proposalSaveSchema = proposalQuerySchema;
