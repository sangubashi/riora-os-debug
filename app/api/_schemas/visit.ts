import { z } from 'zod';
import { idSchema } from './common';

/** VisitInput.skinLevels(Partial<Record<...,number>>)の検証スキーマ。 */
const skinLevelsSchema = z.object({
  acne: z.number().optional(),
  pore: z.number().optional(),
  dryness: z.number().optional(),
  redness: z.number().optional(),
  sagging: z.number().optional(),
  dullness: z.number().optional(),
  firmness: z.number().optional(),
});

/** SaveVisitRecord(POST /api/visits)の入力(VisitInput)検証スキーマ。 */
export const visitInputSchema = z.object({
  customerId: idSchema,
  staffId: idSchema,
  menuId: idSchema,
  isNomination: z.boolean(),
  retailAmount: z.number().nonnegative().optional(),
  retailCategory: z.string().optional(),
  homecarePurchased: z.boolean(),
  homecareDeclined: z.boolean().optional(),
  nextBookingMade: z.boolean(),
  noBookingReason: z.enum(['considering', 'unsure', 'cold']).optional(),
  nextDate: z.string().optional(),
  nextStaffId: z.string().optional(),
  voiceMemoUrl: z.string().optional(),
  skinLevels: skinLevelsSchema,
});

export type VisitInputPayload = z.infer<typeof visitInputSchema>;
