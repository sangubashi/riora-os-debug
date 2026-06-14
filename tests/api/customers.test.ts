import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../../app/api/customers/[id]/route';
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

const VISIT: Visit = {
  id: 'visit-1',
  storeId: 'store-1',
  customerId: 'cust-1',
  staffId: 'staff-1',
  menuId: 'menu-1',
  visitDate: '2026-06-01',
  visitCountAt: 3,
  isNomination: true,
  treatmentAmount: 8000,
  retailAmount: 2000,
  retailCategory: 'shampoo',
  homecarePurchased: true,
  homecareDeclined: false,
  nextBookingMade: true,
  noBookingReason: null,
  voiceMemoUrl: null,
  visitScore: 0.75,
};

const mockRepos = {
  customerRepo: { findById: vi.fn(), listByStore: vi.fn() },
  visitRepo: { recentByCustomer: vi.fn(), create: vi.fn(), countByCustomer: vi.fn() },
  lineQueueRepo: { enqueue: vi.fn(), listPendingByStore: vi.fn(), updateStatus: vi.fn() },
  dashboardRepo: { latestByStore: vi.fn() },
  briefingRepo: { latestByCustomer: vi.fn() },
  revisionRepo: { approve: vi.fn() },
};

function buildRequest(url: string): NextRequest {
  return new NextRequest(url);
}

function callGet(url: string, id: string) {
  return GET(buildRequest(url), { params: Promise.resolve({ id }) });
}

describe('GET /api/customers/:id (GetCustomerDetail)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRepos).mockReturnValue(mockRepos as never);
    mockRepos.customerRepo.findById.mockResolvedValue(CUSTOMER);
    mockRepos.visitRepo.recentByCustomer.mockResolvedValue([VISIT]);
  });

  it('正常系: customerとrecentVisitsを返す', async () => {
    const res = await callGet('http://localhost/api/customers/cust-1', 'cust-1');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, customer: CUSTOMER, recentVisits: [VISIT] });
  });

  it('limit省略時はrecentByCustomerに5を渡す', async () => {
    await callGet('http://localhost/api/customers/cust-1', 'cust-1');

    expect(mockRepos.visitRepo.recentByCustomer).toHaveBeenCalledWith('cust-1', 5);
  });

  it('limitクエリパラメータを指定するとその値を渡す', async () => {
    await callGet('http://localhost/api/customers/cust-1?limit=10', 'cust-1');

    expect(mockRepos.visitRepo.recentByCustomer).toHaveBeenCalledWith('cust-1', 10);
  });

  it('limitが範囲外(0)の場合は400(validation_error)を返す', async () => {
    const res = await callGet('http://localhost/api/customers/cust-1?limit=0', 'cust-1');
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('validation_error');
  });

  it('customerが存在しない場合は404を返す', async () => {
    mockRepos.customerRepo.findById.mockResolvedValue(null);

    const res = await callGet('http://localhost/api/customers/cust-999', 'cust-999');
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ success: false, error: 'customer_not_found' });
  });

  it('Repository factoryがエラーの場合は500を返す', async () => {
    vi.mocked(getRepos).mockImplementation(() => {
      throw new Error('Supabase env not configured');
    });

    const res = await callGet('http://localhost/api/customers/cust-1', 'cust-1');

    expect(res.status).toBe(500);
  });

  it('customerRepo.findById()が例外をthrowした場合は500を返す', async () => {
    mockRepos.customerRepo.findById.mockRejectedValue(new Error('CustomerRepo.findById failed: db down'));

    const res = await callGet('http://localhost/api/customers/cust-1', 'cust-1');

    expect(res.status).toBe(500);
  });
});
