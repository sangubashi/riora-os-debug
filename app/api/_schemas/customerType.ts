import { z } from 'zod';
import { idSchema } from './common';

export const classifyQuerySchema = z.object({
  storeId: idSchema,
});
