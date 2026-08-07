import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../../app/api/proposals/fire/route';
import { getRepos, getServiceClient } from '../../app/lib/repos';
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest';
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer';
import * as generateModule from '../../src/lib/proposal/generateCustomerProposal';
import type { GenerateCustomerProposalResult } from '../../src/lib/proposal/generateCustomerProposal';
import type { BriefingEntry, FinalProposalSet, PatternContext } from '../../src/types/riora.types';

vi.mock('../../app/lib/repos', () => ({ getRepos: vi.fn(), getServiceClient: vi.fn() }));
vi.mock('@/lib/auth/extractStaffFromRequest', () => ({ extractStaffFromRequest: vi.fn() }));
vi.mock('@/lib/auth/canAccessCustomer', () => ({ canAccessCustomer: vi.fn() }));

const STAFF = {
  authUserId: 'auth-uid-1', staffBrainId: 'staff-1',
  email: 'staff@example.com', isAdmin: false,
};

const CTX: PatternContext = {
  visitCount: 2, daysSinceLast: 10, avgCycle: 30, isNominationStreak2: false, homecarePurchasedEver: false,
  homecareDeclinedRecent: false, skinImproved: false, skinStagnant2: false, subscConditionsMet: 0, churnScore: 0,
  nextBookingMadeLast: false, weddingDaysLeft: null, retailTotal: 0,
  raw: { typeConfidence: 0.8, csi: 0.5, skinDeltaTrend: 0, cycleRatio: 1, lastVisitDate: '2026-06-01' },
  customerType: 'B_pore', customerId: 'cust-1', storeId: 'store-1',
};

const PROPOSAL: FinalProposalSet = {
  inStore: { mandatory: { customerId: 'cust-1', candidateCode: 'B1-step1', patternId: 'B1', stepNo: 1, proposalKind: 'none', baseScript: 'x', adjustedScript: 'x', scriptStyle: 'evidence', priority: 1, isMandatory: true, fireScore: 80, decisiveFactor: 'タイミングの良さ(寄与10.0点)' }, secondary: null, candidateDate: null },
  dm: null,
  explanation: { staffLine1: 'B1-step1を提案します。', staffAvoid: null, managerQ1: 'x', managerQ2: 'y', managerQ3: 'z' },
  decisionRecordId: null,
};

const NORMAL_RESULT: GenerateCustomerProposalResult = {
  ok: true, proposal: PROPOSAL, context: CTX,
  voiceMemoContext: { linkStatus: 'no_match', legacyCustomerId: null, customerNotes: [], contraindications: [], latestBookingPromptSummary: null, latestHandoverSummary: null },
  lineHistoryContext: { recentCount: 0, items: [] },
  nextBookingSuggestion: null,
  menuAIContext: null,
};

/** brain_customersに対する `.select().eq().eq().is().maybeSingle()` チェーンのみ模擬する簡易mock。 */
function makeSupabaseClient(customerRow: { id: string; is_internal_user?: boolean } | null) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: customerRow, error: null }),
            }),
          }),
        }),
      }),
    }),
  };
}

const mockRepos = {
  briefingRepo: {
    insert: vi.fn(),
    recentByCustomer: vi.fn(),
  },
};

function buildRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/proposals/fire', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
  });
}

describe('POST /api/proposals/fire', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRepos).mockReturnValue(mockRepos as never);
    vi.mocked(getServiceClient).mockReturnValue(makeSupabaseClient({ id: 'cust-1' }) as never);
    vi.mocked(extractStaffFromRequest).mockResolvedValue(STAFF as never);
    vi.mocked(canAccessCustomer).mockResolvedValue(true);
    mockRepos.briefingRepo.recentByCustomer.mockResolvedValue([]);
    mockRepos.briefingRepo.insert.mockResolvedValue({
      id: 'fire-1', customerId: 'cust-1', customerName: '', visitId: null,
      decisionRecord: {}, explanation: 'x', createdAt: '2026-08-07T00:00:00Z',
    });
  });

  it('未認証の場合は401を返す', async () => {
    vi.mocked(extractStaffFromRequest).mockResolvedValue(null);
    const res = await POST(buildRequest({ customerId: 'cust-1' }));
    expect(res.status).toBe(401);
  });

  it('管理者の場合は400(staff_required)を返す', async () => {
    vi.mocked(extractStaffFromRequest).mockResolvedValue({
      authUserId: 'admin-uid', staffBrainId: 'admin-staff-id', email: 'admin@salon-riora.jp', isAdmin: true,
    } as never);
    const res = await POST(buildRequest({ customerId: 'cust-1' }));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe('staff_required');
  });

  it('staffBrainIdが無いスタッフの場合は400(staff_required)を返す', async () => {
    vi.mocked(extractStaffFromRequest).mockResolvedValue({
      authUserId: 'x', staffBrainId: null, email: 'x@example.com', isAdmin: false,
    } as never);
    const res = await POST(buildRequest({ customerId: 'cust-1' }));
    expect(res.status).toBe(400);
  });

  it('不正なJSONの場合は400(invalid_json)を返す', async () => {
    const res = await POST(buildRequest('not-json'));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_json');
  });

  it('customerId欠落の場合は400(validation_error)を返す', async () => {
    const res = await POST(buildRequest({}));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toBe('validation_error');
  });

  it('顧客が見つからない場合は404(customer_not_found)を返す', async () => {
    vi.mocked(getServiceClient).mockReturnValue(makeSupabaseClient(null) as never);
    const res = await POST(buildRequest({ customerId: 'cust-1' }));
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.error).toBe('customer_not_found');
  });

  it('is_internal_user=trueの顧客の場合は404(customer_not_found)を返す', async () => {
    vi.mocked(getServiceClient).mockReturnValue(makeSupabaseClient({ id: 'cust-1', is_internal_user: true }) as never);
    const res = await POST(buildRequest({ customerId: 'cust-1' }));
    expect(res.status).toBe(404);
  });

  it('canAccessCustomerがfalseの場合は403(forbidden)を返し、insertしない', async () => {
    vi.mocked(canAccessCustomer).mockResolvedValue(false);
    const res = await POST(buildRequest({ customerId: 'cust-1' }));
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.error).toBe('forbidden');
    expect(mockRepos.briefingRepo.insert).not.toHaveBeenCalled();
  });

  it('generateCustomerProposalがok:falseの場合は404を返し、insertしない', async () => {
    vi.spyOn(generateModule, 'generateCustomerProposal').mockResolvedValue({ ok: false, reason: 'no_visit_history' });
    const res = await POST(buildRequest({ customerId: 'cust-1' }));
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.error).toBe('no_visit_history');
    expect(mockRepos.briefingRepo.insert).not.toHaveBeenCalled();
  });

  it('通常提案の場合、200を返しbriefingRepo.insertが正しい構造で呼ばれる', async () => {
    vi.spyOn(generateModule, 'generateCustomerProposal').mockResolvedValue(NORMAL_RESULT);
    const res = await POST(buildRequest({ customerId: 'cust-1' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, fireLogId: 'fire-1', deduped: false });
    expect(mockRepos.briefingRepo.insert).toHaveBeenCalledWith(expect.objectContaining({
      storeId: '00000000-0000-0000-0000-000000000001',
      customerId: 'cust-1',
      visitId: null,
      explanation: 'B1-step1を提案します。',
      decisionRecord: expect.objectContaining({
        patternId: 'B1', stepNo: 1, proposalKind: 'none', scriptStyle: 'evidence',
      }),
    }));
  });

  it('縮退提案の場合も200を返しdecisionRecord.degraded=trueでinsertされる', async () => {
    vi.spyOn(generateModule, 'generateCustomerProposal').mockResolvedValue({
      ...NORMAL_RESULT, proposal: { degraded: true, reason: 'no_active_pattern', proposal: PROPOSAL },
    });
    const res = await POST(buildRequest({ customerId: 'cust-1' }));
    expect(res.status).toBe(200);
    expect(mockRepos.briefingRepo.insert).toHaveBeenCalledWith(expect.objectContaining({
      decisionRecord: expect.objectContaining({ degraded: true, reason: 'no_active_pattern' }),
    }));
  });

  it('重複抑止: 直近60分以内に同一パターンのfire_logが既にある場合はinsertせず既存idを返す', async () => {
    vi.spyOn(generateModule, 'generateCustomerProposal').mockResolvedValue(NORMAL_RESULT);
    const recentEntry: BriefingEntry = {
      id: 'fire-existing', customerId: 'cust-1', customerName: '', visitId: null,
      decisionRecord: { patternId: 'B1', stepNo: 1, proposalKind: 'none', scriptStyle: 'evidence' } as never,
      explanation: 'x', createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    };
    mockRepos.briefingRepo.recentByCustomer.mockResolvedValue([recentEntry]);

    const res = await POST(buildRequest({ customerId: 'cust-1' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, fireLogId: 'fire-existing', deduped: true });
    expect(mockRepos.briefingRepo.insert).not.toHaveBeenCalled();
  });

  it('重複抑止: 直近fire_logが60分より前の場合は重複とみなさずinsertする', async () => {
    vi.spyOn(generateModule, 'generateCustomerProposal').mockResolvedValue(NORMAL_RESULT);
    const oldEntry: BriefingEntry = {
      id: 'fire-old', customerId: 'cust-1', customerName: '', visitId: null,
      decisionRecord: { patternId: 'B1', stepNo: 1, proposalKind: 'none', scriptStyle: 'evidence' } as never,
      explanation: 'x', createdAt: new Date(Date.now() - 120 * 60_000).toISOString(),
    };
    mockRepos.briefingRepo.recentByCustomer.mockResolvedValue([oldEntry]);

    const res = await POST(buildRequest({ customerId: 'cust-1' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.deduped).toBe(false);
    expect(mockRepos.briefingRepo.insert).toHaveBeenCalled();
  });

  it('重複抑止: 直近fire_logのpatternIdが異なる場合は重複とみなさずinsertする', async () => {
    vi.spyOn(generateModule, 'generateCustomerProposal').mockResolvedValue(NORMAL_RESULT);
    const differentEntry: BriefingEntry = {
      id: 'fire-different', customerId: 'cust-1', customerName: '', visitId: null,
      decisionRecord: { patternId: 'C2', stepNo: 1, proposalKind: 'none', scriptStyle: 'evidence' } as never,
      explanation: 'x', createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    };
    mockRepos.briefingRepo.recentByCustomer.mockResolvedValue([differentEntry]);

    const res = await POST(buildRequest({ customerId: 'cust-1' }));
    const body = await res.json();

    expect(body.deduped).toBe(false);
    expect(mockRepos.briefingRepo.insert).toHaveBeenCalled();
  });

  it('Repository factoryがエラーの場合は500を返す', async () => {
    vi.mocked(getRepos).mockImplementation(() => { throw new Error('Supabase env not configured'); });
    const res = await POST(buildRequest({ customerId: 'cust-1' }));
    expect(res.status).toBe(500);
  });

  it('briefingRepo.insertが例外をthrowした場合は500を返す', async () => {
    vi.spyOn(generateModule, 'generateCustomerProposal').mockResolvedValue(NORMAL_RESULT);
    mockRepos.briefingRepo.insert.mockRejectedValue(new Error('insert failed'));
    const res = await POST(buildRequest({ customerId: 'cust-1' }));
    expect(res.status).toBe(500);
  });
});
