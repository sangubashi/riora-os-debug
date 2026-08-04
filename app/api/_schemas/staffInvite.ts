import { z } from 'zod';

/** POST /api/admin/staff/invite の入力(STAFF_MANAGEMENT_PHASE2_2)。 */
export const createInviteBodySchema = z.object({
  staff_name: z.string().trim().min(1, 'staff_name is required'),
  email: z.string().trim().email('invalid email'),
  role: z.enum(['staff', 'owner']),
});

/** POST /api/invite/[token]/complete の入力。 */
export const completeInviteBodySchema = z.object({
  password: z.string().min(8, 'password must be at least 8 characters'),
});
