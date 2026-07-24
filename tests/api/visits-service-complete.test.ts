import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../../app/api/visits/service-complete/route';
import { getRepos } from '../../app/lib/repos';
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest';
import type { Customer, Menu, Visit } from '../../src/types/riora.types';

vi.mock('../../app/lib/repos', () => ({ getRepos: vi.fn() }));
vi.mock('@/lib/auth/extractStaffFromRequest', () => ({ extractStaffFromRequest: vi.fn() }));

const STAFF = {
  authUserId: 'auth-uid-1', staffBrainId: 'staff-1',
  email: 'staff@example.com', isAdmin: false,
};

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
  prefecture: null,
  city: null,
  externalKeyHash: null,
};

const MENU: Menu = {
  id: 'menu-1',
  storeId: 'store-1',
  name: 'ハーブピーリング',
  price: 8000,
  role: 'peeling',
  targetTypes: [],
};

const EXISTING_VISIT: Visit = {
  id: 'visit-1',
  storeId: 'store-1',
  customerId: 'cust-1',
  staffId: 'staff-1',
  menuId: 'menu-1',
  visitDate: '2026-06-01',
  visitCountAt: 3,
  isNomination: false,
  treatmentAmount: 0,
  retailAmount: 0,
  retailCategory: null,
  homecarePurchased: false,
  homecareDeclined: false,
  nextBookingMade: false,
  noBookingReason: null,
  voiceMemoUrl: null,
  visitScore: 0,
  source: 'staff_input',
};

const VALID_PAYLOAD = {
  customerId: 'cust-1',
  menuName: 'ハーブピーリング',
  nextBookingMade: true,
  homecarePurchased: false,
};

const mockRepos = {
  customerRepo: { findById: vi.fn() },
  menuRepo: { listByStore: vi.fn() },
  visitRepo: {
    findByCustomerAndDate: vi.fn(),
    updateNextBookingMade: vi.fn(),
    createSequenced: vi.fn(),
  },
};

function buildRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/visits/service-complete', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
  });
}

describe('POST /api/visits/service-complete (RecordServiceCompletion)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRepos).mockReturnValue(mockRepos as never);
    vi.mocked(extractStaffFromRequest).mockResolvedValue(STAFF as never);
    mockRepos.customerRepo.findById.mockResolvedValue(CUSTOMER);
    mockRepos.menuRepo.listByStore.mockResolvedValue([MENU]);
    mockRepos.visitRepo.findByCustomerAndDate.mockResolvedValue(null);
    mockRepos.visitRepo.createSequenced.mockResolvedValue({ ...EXISTING_VISIT, id: 'visit-new' });
  });

  it('当日分のvisitが無い場合はcreateSequenced()で新規作成する(created:true)', async () => {
    const res = await POST(buildRequest(VALID_PAYLOAD));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toEqual({ success: true, visitId: 'visit-new', created: true });
    expect(mockRepos.visitRepo.updateNextBookingMade).not.toHaveBeenCalled();
  });

  it('新規作成時、staffIdはBearerトークンから解決したstaffBrainIdを渡す(client供給値を信用しない)', async () => {
    await POST(buildRequest(VALID_PAYLOAD));

    expect(mockRepos.visitRepo.createSequenced).toHaveBeenCalledWith(
      expect.objectContaining({ staffId: 'staff-1', customerId: 'cust-1', storeId: 'store-1' })
    );
  });

  it('新規作成時、menuNameをmenuResolverでmenuIdへ解決して渡す', async () => {
    await POST(buildRequest(VALID_PAYLOAD));

    expect(mockRepos.visitRepo.createSequenced).toHaveBeenCalledWith(
      expect.objectContaining({ menuId: 'menu-1' })
    );
  });

  it('新規作成時、nextBookingMadeを入力の値そのまま渡す', async () => {
    await POST(buildRequest({ ...VALID_PAYLOAD, nextBookingMade: false }));

    expect(mockRepos.visitRepo.createSequenced).toHaveBeenCalledWith(
      expect.objectContaining({ nextBookingMade: false })
    );
  });

  it('当日分のvisitが既にある場合はupdateNextBookingMade()のみ呼び、createSequenced()は呼ばない(created:false)', async () => {
    mockRepos.visitRepo.findByCustomerAndDate.mockResolvedValue(EXISTING_VISIT);

    const res = await POST(buildRequest(VALID_PAYLOAD));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, visitId: 'visit-1', created: false });
    expect(mockRepos.visitRepo.updateNextBookingMade).toHaveBeenCalledWith('visit-1', true);
    expect(mockRepos.visitRepo.createSequenced).not.toHaveBeenCalled();
  });

  it('menuNameが解決できない場合は422(menu_unresolved)を返し、何も書き込まない', async () => {
    mockRepos.menuRepo.listByStore.mockResolvedValue([]);

    const res = await POST(buildRequest({ ...VALID_PAYLOAD, menuName: '未知のメニュー名XYZ' }));
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body).toEqual({ success: false, error: 'menu_unresolved' });
    expect(mockRepos.visitRepo.createSequenced).not.toHaveBeenCalled();
    expect(mockRepos.visitRepo.updateNextBookingMade).not.toHaveBeenCalled();
  });

  it('customerが存在しない場合は404を返す', async () => {
    mockRepos.customerRepo.findById.mockResolvedValue(null);

    const res = await POST(buildRequest(VALID_PAYLOAD));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ success: false, error: 'customer_not_found' });
  });

  it('未認証(トークン不正・staff未登録)の場合は401を返す', async () => {
    vi.mocked(extractStaffFromRequest).mockResolvedValue(null);

    const res = await POST(buildRequest(VALID_PAYLOAD));

    expect(res.status).toBe(401);
  });

  it('adminであってもstaffBrainIdが無ければ401を返す(brain_visits.staff_idのFKを満たせないため)', async () => {
    vi.mocked(extractStaffFromRequest).mockResolvedValue({
      authUserId: 'admin-uid', staffBrainId: null, email: 'admin@salon-riora.jp', isAdmin: true,
    } as never);

    const res = await POST(buildRequest(VALID_PAYLOAD));

    expect(res.status).toBe(401);
  });

  it('必須フィールドが欠落している場合は400(validation_error)を返す', async () => {
    const { customerId: _customerId, ...rest } = VALID_PAYLOAD;
    void _customerId;

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

  it('Repository factoryがエラーの場合は500を返す', async () => {
    vi.mocked(getRepos).mockImplementation(() => {
      throw new Error('Supabase env not configured');
    });

    const res = await POST(buildRequest(VALID_PAYLOAD));

    expect(res.status).toBe(500);
  });

  it('visitRepo.createSequenced()が例外をthrowした場合は500を返す', async () => {
    mockRepos.visitRepo.createSequenced.mockRejectedValue(new Error('lock timeout'));

    const res = await POST(buildRequest(VALID_PAYLOAD));

    expect(res.status).toBe(500);
  });
});
