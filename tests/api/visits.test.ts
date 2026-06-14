import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../../app/api/visits/route';
import { getRepos } from '../../app/lib/repos';
import type { Customer, Visit } from '../../src/types/riora.types';

vi.mock('../../app/lib/repos', () => ({ getRepos: vi.fn() }));

const CUSTOMER: Customer = {
  id: 'cust-1',
  storeId: 'store-1',
  name: '山田花子',
  ageGroup: '30s',
  customerType: 'B_pore',
  typeConfidence: 0.8,
  goalNote: null,
  weddingDate: null,
  acquisitionChannel: null,
  firstVisitDate: '2025-01-01',
  assignedStaffId: 'staff-1',
  isSubscriber: false,
  subscribedAt: null,
  churnScore: 0.1,
  churnReason: null,
  consentAnonymizedLearning: true,
};

const CREATED_VISIT: Visit = {
  id: 'visit-1',
  storeId: 'store-1',
  customerId: 'cust-1',
  staffId: 'staff-1',
  menuId: 'menu-1',
  visitDate: '2026-06-13T00:00:00Z',
  visitCountAt: 4,
  isNomination: true,
  treatmentAmount: 0,
  retailAmount: 0,
  retailCategory: null,
  homecarePurchased: false,
  homecareDeclined: false,
  nextBookingMade: true,
  noBookingReason: null,
  voiceMemoUrl: null,
  visitScore: 0,
};

const VALID_PAYLOAD = {
  customerId: 'cust-1',
  staffId: 'staff-1',
  menuId: 'menu-1',
  isNomination: true,
  homecarePurchased: false,
  nextBookingMade: true,
  skinLevels: {},
};

const mockRepos = {
  customerRepo: { findById: vi.fn(), listByStore: vi.fn() },
  visitRepo: { recentByCustomer: vi.fn(), create: vi.fn(), countByCustomer: vi.fn() },
  lineQueueRepo: { enqueue: vi.fn(), listPendingByStore: vi.fn(), updateStatus: vi.fn() },
  dashboardRepo: { latestByStore: vi.fn() },
  briefingRepo: { latestByCustomer: vi.fn() },
  revisionRepo: { approve: vi.fn() },
};

function buildRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/visits', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/visits (SaveVisitRecord)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRepos).mockReturnValue(mockRepos as never);
    mockRepos.customerRepo.findById.mockResolvedValue(CUSTOMER);
    mockRepos.visitRepo.countByCustomer.mockResolvedValue(3);
    mockRepos.visitRepo.create.mockResolvedValue(CREATED_VISIT);
  });

  it('正常な入力で201とvisitを返す', async () => {
    const res = await POST(buildRequest(VALID_PAYLOAD));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toEqual({ success: true, visit: CREATED_VISIT });
  });

  it('visitCountAtはvisitRepo.countByCustomer()+1で算出する', async () => {
    await POST(buildRequest(VALID_PAYLOAD));

    expect(mockRepos.visitRepo.create).toHaveBeenCalledWith(expect.objectContaining({ visitCountAt: 4 }));
  });

  it('storeIdはcustomerRepo.findById()の結果から設定する', async () => {
    await POST(buildRequest(VALID_PAYLOAD));

    expect(mockRepos.visitRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ storeId: 'store-1', customerId: 'cust-1' })
    );
  });

  it('treatmentAmount/visitScoreは0を設定する(Engine呼び出しなし)', async () => {
    await POST(buildRequest(VALID_PAYLOAD));

    expect(mockRepos.visitRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ treatmentAmount: 0, visitScore: 0 })
    );
  });

  it('省略可能フィールドはデフォルト値を適用する', async () => {
    await POST(buildRequest(VALID_PAYLOAD));

    expect(mockRepos.visitRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        retailAmount: 0,
        retailCategory: null,
        homecareDeclined: false,
        noBookingReason: null,
        voiceMemoUrl: null,
      })
    );
  });

  it('必須フィールドが欠落している場合は400(validation_error)を返す', async () => {
    const { customerId, ...rest } = VALID_PAYLOAD;
    void customerId;

    const res = await POST(buildRequest(rest));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toBe('validation_error');
  });

  it('不正なJSONの場合は400を返す', async () => {
    const res = await POST(buildRequest('not-json'));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({ success: false, error: 'invalid_json' });
  });

  it('customerが存在しない場合は404を返す', async () => {
    mockRepos.customerRepo.findById.mockResolvedValue(null);

    const res = await POST(buildRequest(VALID_PAYLOAD));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ success: false, error: 'customer_not_found' });
  });

  it('Repository factoryがエラーの場合は500を返す', async () => {
    vi.mocked(getRepos).mockImplementation(() => {
      throw new Error('Supabase env not configured');
    });

    const res = await POST(buildRequest(VALID_PAYLOAD));

    expect(res.status).toBe(500);
  });

  it('visitRepo.create()が例外をthrowした場合は500を返す', async () => {
    mockRepos.visitRepo.create.mockRejectedValue(new Error('VisitRepo.create failed: insert failed'));

    const res = await POST(buildRequest(VALID_PAYLOAD));

    expect(res.status).toBe(500);
  });
});
