import { z } from 'zod';
import { idSchema } from './common';

export const templateCreateSchema = z.object({
  categoryId: z.string().nullable(),
  title: z.string().min(1),
  body: z.string().min(1),
  tags: z.array(z.string()).default([]),
});

export const templateUpdateSchema = z.object({
  categoryId: z.string().nullable().optional(),
  title: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
  tags: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
});

export const recipientIdParamSchema = z.object({
  recipientId: idSchema,
});

export const templateIdParamSchema = z.object({
  id: idSchema,
});
