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

/**
 * RecordServiceCompletion(POST /api/visits/service-complete)の入力検証スキーマ(Phase 1-E)。
 * 接客ログ画面(CustomerBottomSheet.tsx)からの「次回予約が取れた」記録専用。staffIdは
 * リクエストのBearerトークンから解決するため入力に含めない(client供給値を信用しない)。
 */
export const serviceCompleteInputSchema = z.object({
  customerId: idSchema,
  menuName: z.string().min(1, 'menuName is required'),
  nextBookingMade: z.boolean(),
  homecarePurchased: z.boolean().optional(),
});

export type ServiceCompleteInputPayload = z.infer<typeof serviceCompleteInputSchema>;
