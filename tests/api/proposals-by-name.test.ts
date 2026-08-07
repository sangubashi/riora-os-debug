import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '../../app/api/proposals/by-name/route';
import { getRepos, getServiceClient } from '../../app/lib/repos';
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest';
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer';
import * as generateModule from '../../src/lib/proposal/generateCustomerProposal';
import type { GenerateCustomerProposalResult } from '../../src/lib/proposal/generateCustomerProposal';
import type { FinalProposalSet, PatternContext } from '../../src/types/riora.types';

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

/** チェーンメソッドが全て自身を返し、awaitされた時点でresultへ解決する簡易thenableモック。 */
function makeChainable(result: { data: unknown; error: null }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {};
  for (const m of ['select', 'eq', 'is', 'limit', 'order']) {
    builder[m] = vi.fn(() => builder);
  }
  builder.then = (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve);
  return builder;
}

function makeSupabaseClient(customerMatches: unknown[] | null, visits: unknown[] = []) {
  const customersBuilder = makeChainable({ data: customerMatches, error: null });
  const visitsBuilder = makeChainable({ data: visits, error: null });
  return {
    from: vi.fn((table: string) => (table === 'brain_customers' ? customersBuilder : visitsBuilder)),
    __customersBuilder: customersBuilder,
  };
}

function buildRequest(qs: string): NextRequest {
  return new NextRequest(`http://localhost/api/proposals/by-name${qs}`, {
    headers: { Authorization: 'Bearer token' },
  });
}

describe('GET /api/proposals/by-name', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRepos).mockReturnValue({} as never);
    vi.mocked(extractStaffFromRequest).mockResolvedValue(STAFF as never);
    vi.mocked(canAccessCustomer).mockResolvedValue(true);
    vi.spyOn(generateModule, 'generateCustomerProposal').mockResolvedValue(NORMAL_RESULT);
  });

  it('未認証の場合は401(found:false)を返す', async () => {
    vi.mocked(extractStaffFromRequest).mockResolvedValue(null);
    const res = await GET(buildRequest('?customerId=cust-1'));
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.found).toBe(false);
  });

  it('管理者の場合は400(staff_required)を返す', async () => {
    vi.mocked(extractStaffFromRequest).mockResolvedValue({
      authUserId: 'admin-uid', staffBrainId: 'admin-staff-id', email: 'admin@salon-riora.jp', isAdmin: true,
    } as never);
    const res = await GET(buildRequest('?customerId=cust-1'));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.reason).toBe('staff_required');
  });

  it('customerId・customerNameとも未指定の場合はfound:false(missing_customer_identifier)を返す', async () => {
    const res = await GET(buildRequest(''));
    const body = await res.json();
    expect(body).toEqual({ found: false, reason: 'missing_customer_identifier' });
  });

  it('customerId指定時、brain_customersをidで検索する', async () => {
    const client = makeSupabaseClient([{ id: 'cust-1', customer_type: 'B_pore', is_internal_user: false }]);
    vi.mocked(getServiceClient).mockReturnValue(client as never);

    const res = await GET(buildRequest('?customerId=cust-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.found).toBe(true);
    expect(body.advice).toBe('B1-step1を提案します。');
    expect(client.__customersBuilder.eq).toHaveBeenCalledWith('id', 'cust-1');
  });

  it('customerName指定時(既存AIProposalViewの呼び出し経路)、brain_customersをnameで検索する(回帰確認)', async () => {
    const client = makeSupabaseClient([{ id: 'cust-1', customer_type: 'B_pore', is_internal_user: false }]);
    vi.mocked(getServiceClient).mockReturnValue(client as never);

    const res = await GET(buildRequest('?customerName=%E7%94%B0%E4%B8%AD%E8%8A%B1%E5%AD%90'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.found).toBe(true);
    expect(client.__customersBuilder.eq).toHaveBeenCalledWith('name', '田中花子');
  });

  it('customerId・customerName両方指定時はcustomerIdを優先する', async () => {
    const client = makeSupabaseClient([{ id: 'cust-1', customer_type: 'B_pore', is_internal_user: false }]);
    vi.mocked(getServiceClient).mockReturnValue(client as never);

    await GET(buildRequest('?customerId=cust-1&customerName=%E4%BB%96%E4%BA%BA'));

    expect(client.__customersBuilder.eq).toHaveBeenCalledWith('id', 'cust-1');
    expect(client.__customersBuilder.eq).not.toHaveBeenCalledWith('name', expect.anything());
  });

  it('該当顧客が無い場合はfound:false(customer_not_found)を返す', async () => {
    const client = makeSupabaseClient([]);
    vi.mocked(getServiceClient).mockReturnValue(client as never);

    const res = await GET(buildRequest('?customerId=missing'));
    const body = await res.json();
    expect(body).toEqual({ found: false, reason: 'customer_not_found' });
  });

  it('is_internal_user=trueの顧客はfound:false(customer_not_found)を返す', async () => {
    const client = makeSupabaseClient([{ id: 'cust-1', customer_type: 'B_pore', is_internal_user: true }]);
    vi.mocked(getServiceClient).mockReturnValue(client as never);

    const res = await GET(buildRequest('?customerId=cust-1'));
    const body = await res.json();
    expect(body).toEqual({ found: false, reason: 'customer_not_found' });
  });

  it('canAccessCustomerがfalseの場合は403(forbidden)を返す', async () => {
    const client = makeSupabaseClient([{ id: 'cust-1', customer_type: 'B_pore', is_internal_user: false }]);
    vi.mocked(getServiceClient).mockReturnValue(client as never);
    vi.mocked(canAccessCustomer).mockResolvedValue(false);

    const res = await GET(buildRequest('?customerId=cust-1'));
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.reason).toBe('forbidden');
  });
});
