// ================================================================
// generateCustomerProposal 検証(AI提案本物化)
//
// 既存ProposalOrchestrator(実装済・テスト済)を実際に呼び出すオーケストレーション
// 関数。実データが無い場合(customer_not_found/no_visit_history等)は誠実に
// その旨を返し、架空の提案を作らないことを確認する。
// ================================================================
import { describe, expect, it, vi } from 'vitest';
import { generateCustomerProposal, type ProposalGenerationRepos } from '../../../src/lib/proposal/generateCustomerProposal';
import type { Customer, Visit, Staff, Candidate, Store, ScoringWeights } from '../../../src/types/riora.types';
import type { StyleAffinityTable } from '../../../src/types/brain.types';

function customer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 'c1', storeId: 'store-1', name: '田中花子', ageGroup: null, customerType: 'B_pore',
    typeConfidence: 0.8, goalNote: null, weddingDate: null, acquisitionChannel: null,
    firstVisitDate: '2026-01-01', assignedStaffId: null, isSubscriber: false, subscribedAt: null,
    churnScore: 0, churnReason: null, consentAnonymizedLearning: false, prefecture: null, city: null,
    externalKeyHash: null, ...overrides,
  };
}

let visitSeq = 0;
function visit(overrides: Partial<Visit> = {}): Visit {
  visitSeq += 1;
  return {
    id: `v${visitSeq}`, storeId: 'store-1', customerId: 'c1', staffId: 'staff-1', menuId: 'menu-1',
    visitDate: '2026-06-01', visitCountAt: 1, isNomination: false, treatmentAmount: 10000, retailAmount: 0,
    retailCategory: null, homecarePurchased: false, homecareDeclined: false, nextBookingMade: false,
    noBookingReason: null, voiceMemoUrl: null, visitScore: 0, ...overrides,
  };
}

function staff(): Staff {
  return { id: 'staff-1', storeId: 'store-1', name: '鈴木', style: 'evidence', isActive: true, nameAliases: [] };
}

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    uid: 'cand-1', code: 'B1-step1', channel: 'in_store', patternCode: 'B1', stepNo: 1,
    proposalKind: 'none', isSales: false, priorityClass: 1, hardCondition: { '==': [1, 1] },
    softFeatures: { weights: {} }, baseScript: '実際の台本', cooldownVisits: 0, lifecycleStatus: 'active', version: 1,
    ...overrides,
  };
}

function store(): Store {
  return { id: 'store-1', name: 'テスト店', anonId: 'anon-1', anonSalt: 'salt', cluster: 'office_area', priceTier: 'standard', brainSubscription: false, learningMode: false };
}

function weights(): ScoringWeights {
  return { w1: 0.3, w2: 0.2, w3: 0.2, w4: 0.15, w5: 0.15 };
}

function styleAffinity(): StyleAffinityTable {
  const perKind = { none: 0.5, pack: 0.5, upsell: 0.5, homecare: 0.5, rebooking: 0.5, subscription: 0.5 };
  return { theory: { ...perKind }, empathy: { ...perKind }, evidence: { ...perKind } };
}

function createFakeRepos(overrides: { customer?: Customer | null; visits?: Visit[]; candidates?: Candidate[] } = {}): ProposalGenerationRepos {
  return {
    customerRepo: { findById: async () => (overrides.customer !== undefined ? overrides.customer : customer()), listByStore: async () => [], findByExternalKeyHash: async () => null, create: async () => customer(), patchFromImport: async () => customer(), updateCustomerType: async () => customer() },
    visitRepo: {
      recentByCustomer: async () => overrides.visits ?? [visit({ visitDate: '2026-05-01' }), visit({ visitDate: '2026-06-01' })],
      create: async (v) => ({ ...v, id: 'new-visit' }), countByCustomer: async () => 0, findByCustomerAndDate: async () => null,
      reconcile: async (id) => ({ ...visit(), id }), sumSalesByStoreAndDate: async () => 0, listByStore: async () => [], updateMenuId: async () => {},
    },
    staffRepo: { listByStore: async () => [staff()], addNameAlias: async () => null, deactivate: async () => null, create: async () => { throw new Error('not implemented in test fake'); } },
    subscriptionRepo: { listByStore: async () => [] },
    outcomeRepo: { recent: async () => [], create: async (input) => ({ id: 'new-outcome', ...input }) },
    candidateRepo: { loadActive: async () => overrides.candidates ?? [candidate()] },
    paramsRepo: { weights: async () => weights(), styleAffinity: async () => styleAffinity() },
    statsRepo: { loadCells: async () => new Map(), refreshStepStats: async () => {} },
    storeRepo: { findById: async () => store() },
    lineQueueRepo: { enqueue: async () => 'q1', listPendingByStore: async () => [], updateStatus: async () => null, recentByCustomer: async () => [] },
  };
}

describe('generateCustomerProposal', () => {
  it('顧客が存在しない場合はcustomer_not_foundを返す(架空の顧客で提案を作らない)', async () => {
    const result = await generateCustomerProposal(
      { storeId: 'store-1', customerId: 'missing', staffId: 'staff-1' },
      createFakeRepos({ customer: null })
    );
    expect(result).toEqual({ ok: false, reason: 'customer_not_found' });
  });

  it('スタッフが存在しない場合はstaff_not_foundを返す', async () => {
    const result = await generateCustomerProposal(
      { storeId: 'store-1', customerId: 'c1', staffId: 'unknown-staff' },
      createFakeRepos()
    );
    expect(result).toEqual({ ok: false, reason: 'staff_not_found' });
  });

  it('customerTypeが未設定の場合はno_customer_typeを返す', async () => {
    const result = await generateCustomerProposal(
      { storeId: 'store-1', customerId: 'c1', staffId: 'staff-1' },
      createFakeRepos({ customer: customer({ customerType: null }) })
    );
    expect(result).toEqual({ ok: false, reason: 'no_customer_type' });
  });

  it('来店履歴が0件の場合はno_visit_historyを返す', async () => {
    const result = await generateCustomerProposal(
      { storeId: 'store-1', customerId: 'c1', staffId: 'staff-1' },
      createFakeRepos({ visits: [] })
    );
    expect(result).toEqual({ ok: false, reason: 'no_visit_history' });
  });

  it('実データが揃っている場合、ProposalOrchestratorを実際に呼び出しFinalProposalSetを返す', async () => {
    const repos = createFakeRepos({ candidates: [candidate({ code: 'B1-step1', proposalKind: 'none' })] });
    const result = await generateCustomerProposal(
      { storeId: 'store-1', customerId: 'c1', staffId: 'staff-1', nowJst: '2026-06-25' },
      repos
    );

    expect(result.ok).toBe(true);
    if (result.ok && !('degraded' in result.proposal)) {
      expect(result.proposal.inStore.mandatory?.candidateCode).toBe('B1-step1');
      expect(result.proposal.explanation.staffLine1).toContain('B1-step1');
    }
    expect(result.ok && result.lineHistoryContext.recentCount).toBe(0);
    expect(result.ok && result.voiceMemoContext.linkStatus).toBe('no_match'); // legacyClient未指定
  });

  it('legacyClient指定時、氏名一致する旧顧客が1件あればvoiceMemoContext.linkStatus=matchedになる', async () => {
    const legacyClient = {
      from: vi.fn((table: string) => {
        if (table === 'customers') {
          return { select: () => ({ eq: () => Promise.resolve({ data: [{ id: 'legacy-1' }], error: null }) }) };
        }
        if (table === 'customer_notes') {
          return { select: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [{ note: 'メモ', created_at: '2026-06-01' }], error: null }) }) }) }) };
        }
        return { select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }), then: undefined }) }) };
      }),
    } as unknown as Parameters<typeof generateCustomerProposal>[0]['legacyClient'];

    const result = await generateCustomerProposal(
      { storeId: 'store-1', customerId: 'c1', staffId: 'staff-1', legacyClient },
      createFakeRepos()
    );

    expect(result.ok && result.voiceMemoContext.linkStatus).toBe('matched');
    expect(result.ok && result.voiceMemoContext.legacyCustomerId).toBe('legacy-1');
  });

  it('legacyClient指定時、氏名一致する旧顧客が複数件あればambiguous_matchになる(架空に1件を選ばない)', async () => {
    const legacyClient = {
      from: vi.fn(() => ({ select: () => ({ eq: () => Promise.resolve({ data: [{ id: 'legacy-1' }, { id: 'legacy-2' }], error: null }) }) })),
    } as unknown as Parameters<typeof generateCustomerProposal>[0]['legacyClient'];

    const result = await generateCustomerProposal(
      { storeId: 'store-1', customerId: 'c1', staffId: 'staff-1', legacyClient },
      createFakeRepos()
    );

    expect(result.ok && result.voiceMemoContext.linkStatus).toBe('ambiguous_match');
    expect(result.ok && result.voiceMemoContext.legacyCustomerId).toBeNull();
  });
});
