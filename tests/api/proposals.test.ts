import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '../../app/api/admin/proposals/route';
import { getRepos, getServiceClient } from '../../app/lib/repos';
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest';
import * as generateModule from '../../src/lib/proposal/generateCustomerProposal';
import type { GenerateCustomerProposalResult } from '../../src/lib/proposal/generateCustomerProposal';
import type { FinalProposalSet, PatternContext } from '../../src/types/riora.types';

vi.mock('../../app/lib/repos', () => ({ getRepos: vi.fn(), getServiceClient: vi.fn() }));
vi.mock('@/lib/auth/extractStaffFromRequest', () => ({ extractStaffFromRequest: vi.fn() }));

const ADMIN_STAFF = {
  authUserId: 'admin-auth-uid', staffBrainId: 'admin-staff-id',
  email: 'admin@salon-riora.jp', isAdmin: true,
};

const mockRepos = { briefingRepo: { insert: vi.fn() } };

function buildGetReq(qs: string) {
  return new NextRequest(`http://localhost/api/admin/proposals${qs}`);
}
function buildPostReq(body: unknown) {
  return new NextRequest('http://localhost/api/admin/proposals', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
}

const CTX: PatternContext = {
  visitCount: 2, daysSinceLast: 10, avgCycle: 30, isNominationStreak2: false, homecarePurchasedEver: false,
  homecareDeclinedRecent: false, skinImproved: false, skinStagnant2: false, subscConditionsMet: 0, churnScore: 0,
  nextBookingMadeLast: false, weddingDaysLeft: null, retailTotal: 0,
  raw: { typeConfidence: 0.8, csi: 0.5, skinDeltaTrend: 0, cycleRatio: 1, lastVisitDate: '2026-06-01' },
  customerType: 'B_pore', customerId: 'c1', storeId: 'store-1',
};

const PROPOSAL: FinalProposalSet = {
  inStore: { mandatory: { customerId: 'c1', candidateCode: 'B1-step1', patternId: 'B1', stepNo: 1, proposalKind: 'none', baseScript: 'x', adjustedScript: 'x', scriptStyle: 'evidence', priority: 1, isMandatory: true, fireScore: 80, decisiveFactor: 'タイミングの良さ(寄与10.0点)' }, secondary: null, candidateDate: null },
  dm: null,
  explanation: { staffLine1: 'B1-step1を提案します。', staffAvoid: null, managerQ1: 'x', managerQ2: 'y', managerQ3: 'z' },
  decisionRecordId: null,
};

const SUCCESS_RESULT: GenerateCustomerProposalResult = {
  ok: true, proposal: PROPOSAL, context: CTX,
  voiceMemoContext: { linkStatus: 'no_match', legacyCustomerId: null, customerNotes: [], contraindications: [], latestBookingPromptSummary: null, latestHandoverSummary: null },
  lineHistoryContext: { recentCount: 0, items: [] },
};

describe('GET/POST /api/admin/proposals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRepos).mockReturnValue(mockRepos as never);
    vi.mocked(getServiceClient).mockReturnValue({} as never);
    vi.mocked(extractStaffFromRequest).mockResolvedValue(ADMIN_STAFF as never);
  });

  it('GET: storeId/customerId/staffId未指定の場合は400(validation_error)を返す', async () => {
    const res = await GET(buildGetReq(''));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('validation_error');
  });

  it('GET: 顧客が見つからない場合は404を返す', async () => {
    vi.spyOn(generateModule, 'generateCustomerProposal').mockResolvedValue({ ok: false, reason: 'customer_not_found' });
    const res = await GET(buildGetReq('?storeId=store-1&customerId=missing&staffId=staff-1'));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('customer_not_found');
  });

  it('GET: 実データが揃っている場合は提案を返す(DB書込なし)', async () => {
    vi.spyOn(generateModule, 'generateCustomerProposal').mockResolvedValue(SUCCESS_RESULT);
    const res = await GET(buildGetReq('?storeId=store-1&customerId=c1&staffId=staff-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.proposal.inStore.mandatory.candidateCode).toBe('B1-step1');
    expect(mockRepos.briefingRepo.insert).not.toHaveBeenCalled();
  });

  it('POST: 提案を生成し、brain_pattern_fire_logへ保存する(提案結果保存)', async () => {
    vi.spyOn(generateModule, 'generateCustomerProposal').mockResolvedValue(SUCCESS_RESULT);
    mockRepos.briefingRepo.insert.mockResolvedValue({ id: 'fire-1', customerId: 'c1', customerName: '田中花子', visitId: null, decisionRecord: {}, explanation: 'B1-step1を提案します。', createdAt: '2026-06-25T00:00:00Z' });

    const res = await POST(buildPostReq({ storeId: 'store-1', customerId: 'c1', staffId: 'staff-1' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.saved.id).toBe('fire-1');
    expect(mockRepos.briefingRepo.insert).toHaveBeenCalledWith(expect.objectContaining({
      storeId: 'store-1', customerId: 'c1', visitId: null, explanation: 'B1-step1を提案します。',
    }));
  });

  it('POST: 不正なJSONの場合は400(invalid_json)を返す', async () => {
    const req = new NextRequest('http://localhost/api/admin/proposals', { method: 'POST', body: '{bad' });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_json');
  });

  it('POST: 顧客が見つからない場合は404を返し、保存も行わない', async () => {
    vi.spyOn(generateModule, 'generateCustomerProposal').mockResolvedValue({ ok: false, reason: 'no_visit_history' });
    const res = await POST(buildPostReq({ storeId: 'store-1', customerId: 'c1', staffId: 'staff-1' }));

    expect(res.status).toBe(404);
    expect(mockRepos.briefingRepo.insert).not.toHaveBeenCalled();
  });

  it('Repository factoryがエラーの場合は500を返す', async () => {
    vi.mocked(getRepos).mockImplementation(() => { throw new Error('Supabase env not configured'); });
    const res = await GET(buildGetReq('?storeId=store-1&customerId=c1&staffId=staff-1'));
    expect(res.status).toBe(500);
  });
});
