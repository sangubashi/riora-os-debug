import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../../app/api/admin/churn-risk/instruct/route';
import { getRepos } from '../../app/lib/repos';
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest';
import type { Customer, Staff, OpsLog } from '../../src/types/riora.types';

vi.mock('../../app/lib/repos', () => ({ getRepos: vi.fn() }));
vi.mock('@/lib/auth/extractStaffFromRequest', () => ({ extractStaffFromRequest: vi.fn() }));

const ADMIN_STAFF = {
  authUserId: 'admin-auth-uid', staffBrainId: 'admin-staff-id',
  email: 'admin@salon-riora.jp', isAdmin: true,
};

const CUSTOMER: Customer = {
  id: 'c1', storeId: 'store-1', name: '危険客', ageGroup: null, customerType: null,
  typeConfidence: 0, goalNote: null, weddingDate: null, acquisitionChannel: null,
  firstVisitDate: null, assignedStaffId: 'staff-1', isSubscriber: false,
  subscribedAt: null, churnScore: 0, churnReason: null, consentAnonymizedLearning: false,
  prefecture: null, city: null, externalKeyHash: null,
};

const STAFF: Staff = { id: 'staff-1', storeId: 'store-1', name: '鈴木', style: 'evidence', isActive: true, nameAliases: [] };

const mockRepos = {
  customerRepo: { findById: vi.fn() },
  staffRepo: { listByStore: vi.fn() },
  opsLogRepo: { insert: vi.fn() },
};

function buildReq(body: unknown) {
  return new NextRequest('http://localhost/api/admin/churn-risk/instruct', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/admin/churn-risk/instruct (担当スタッフへ指示)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRepos).mockReturnValue(mockRepos as never);
    vi.mocked(extractStaffFromRequest).mockResolvedValue(ADMIN_STAFF as never);
    mockRepos.customerRepo.findById.mockResolvedValue(CUSTOMER);
    mockRepos.staffRepo.listByStore.mockResolvedValue([STAFF]);
    mockRepos.opsLogRepo.insert.mockResolvedValue({
      id: 'log-1', storeId: 'store-1', kind: 'churn_instruction', actorId: null,
      detail: {}, createdAt: '2026-06-23T00:00:00.000Z',
    } satisfies OpsLog);
  });

  it('brain_ops_logs(kind=churn_instruction)へ記録する(LINE送信・予約操作は行わない)', async () => {
    const res = await POST(buildReq({ storeId: 'store-1', customerId: 'c1', staffId: 'staff-1', note: '次回来店時にフォロー' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockRepos.opsLogRepo.insert).toHaveBeenCalledWith({
      storeId: 'store-1',
      kind: 'churn_instruction',
      actorId: null,
      detail: { customerId: 'c1', staffId: 'staff-1', note: '次回来店時にフォロー' },
    });
  });

  it('必須項目が欠けている場合は400(validation_error)を返す', async () => {
    const res = await POST(buildReq({ storeId: 'store-1', customerId: 'c1' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('validation_error');
    expect(mockRepos.opsLogRepo.insert).not.toHaveBeenCalled();
  });

  it('customerIdが別店舗または存在しない場合は404(customer_not_found)を返す', async () => {
    mockRepos.customerRepo.findById.mockResolvedValue(null);

    const res = await POST(buildReq({ storeId: 'store-1', customerId: 'c-missing', staffId: 'staff-1', note: 'x' }));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('customer_not_found');
  });

  it('customerのstore_idがリクエストのstoreIdと不一致の場合は404を返す(店舗越境防止)', async () => {
    mockRepos.customerRepo.findById.mockResolvedValue({ ...CUSTOMER, storeId: 'store-2' });

    const res = await POST(buildReq({ storeId: 'store-1', customerId: 'c1', staffId: 'staff-1', note: 'x' }));
    expect(res.status).toBe(404);
  });

  it('staffIdが店舗に存在しない場合は404(staff_not_found)を返す', async () => {
    mockRepos.staffRepo.listByStore.mockResolvedValue([]);

    const res = await POST(buildReq({ storeId: 'store-1', customerId: 'c1', staffId: 'staff-missing', note: 'x' }));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('staff_not_found');
  });

  it('不正なJSONの場合は400(invalid_json)を返す', async () => {
    const req = new NextRequest('http://localhost/api/admin/churn-risk/instruct', { method: 'POST', body: '{invalid' });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_json');
  });

  it('Repository factoryがエラーの場合は500を返す', async () => {
    vi.mocked(getRepos).mockImplementation(() => {
      throw new Error('Supabase env not configured');
    });

    const res = await POST(buildReq({ storeId: 'store-1', customerId: 'c1', staffId: 'staff-1', note: 'x' }));
    expect(res.status).toBe(500);
  });
});
