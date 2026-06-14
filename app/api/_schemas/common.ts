import { z } from 'zod';

/**
 * brain_*テーブルのid/参照id。
 * UUID形式チェックはDB側(uuid型カラム)に委ね、ここでは非空文字列のみ検証する。
 */
export const idSchema = z.string().min(1, 'id is required');

export interface ValidationErrorResponse {
  success: false;
  error: 'validation_error';
  details: { path: PropertyKey[]; message: string }[];
}

export function toValidationErrorResponse(error: z.ZodError): ValidationErrorResponse {
  return {
    success: false,
    error: 'validation_error',
    details: error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
  };
}
