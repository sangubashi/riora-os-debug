import { describe, expect, it, vi } from 'vitest';
import { runCustomerTypeClassification, type ClassificationRunRepos } from '../../../src/lib/customerType/runCustomerTypeClassification';
import type { Customer, Menu, Visit } from '../../../src/types/riora.types';

function customer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 'cust-1', storeId: 'store-1', name: '田中花子', ageGroup: null, customerType: null, typeConfidence: 0,
    goalNote: null, weddingDate: null, acquisitionChannel: null, firstVisitDate: null, assignedStaffId: null,
    isSubscriber: false, subscribedAt: null, churnScore: 0, churnReason: null, consentAnonymizedLearning: false,
    prefecture: null, city: null, externalKeyHash: null, ...overrides,
  };
}

function menu(overrides: Partial<Menu> = {}): Menu {
  return { id: 'menu-1', storeId: 'store-1', name: 'メニュー', price: 10000, role: 'entry', targetTypes: [], ...overrides };
}

function visit(overrides: Partial<Visit> = {}): Visit {
  return {
    id: 'visit-1', storeId: 'store-1', customerId: 'cust-1', staffId: 'staff-1', menuId: 'menu-1',
    visitDate: '2026-06-01', visitCountAt: 1, isNomination: false, treatmentAmount: 10000, retailAmount: 0,
    retailCategory: null, homecarePurchased: false, homecareDeclined: false, nextBookingMade: false,
    noBookingReason: null, voiceMemoUrl: null, visitScore: 50, ...overrides,
  };
}

function createRepos(overrides: { customers?: Customer[]; visits?: Visit[]; menus?: Menu[] } = {}): { repos: ClassificationRunRepos; updateSpy: ReturnType<typeof vi.fn> } {
  const updateSpy = vi.fn(async (id: string, input: { customerType: string | null; typeConfidence: number }) => ({
    ...customer({ id }),
    customerType: input.customerType as Customer['customerType'],
    typeConfidence: input.typeConfidence,
  }));
  const repos: ClassificationRunRepos = {
    customerRepo: {
      findById: async () => null,
      listByStore: async () => overrides.customers ?? [customer()],
      findByExternalKeyHash: async () => null,
      create: async () => customer(),
      patchFromImport: async () => customer(),
      updateCustomerType: updateSpy as ClassificationRunRepos['customerRepo']['updateCustomerType'],
    },
    visitRepo: {
      recentByCustomer: async () => [],
      create: async (v) => ({ ...v, id: 'new' }),
      countByCustomer: async () => 0,
      findByCustomerAndDate: async () => null,
      reconcile: async (id) => ({ ...visit(), id }),
      sumSalesByStoreAndDate: async () => 0,
      listByStore: async () => overrides.visits ?? [],
      updateMenuId: async () => {},
    },
    menuRepo: {
      listByStore: async () => overrides.menus ?? [],
      findById: async () => null,
      create: async (input) => ({ id: 'menu-new', storeId: input.storeId, name: input.name, price: input.price, role: input.role, targetTypes: input.targetTypes }),
      update: async () => null,
      softDelete: async () => {},
      countVisitsByMenuId: async () => 0,
    },
  };
  return { repos, updateSpy };
}

describe('runCustomerTypeClassification', () => {
  it('既にcustomer_typeが設定済みの顧客は上書きせずスキップする', async () => {
    const { repos, updateSpy } = createRepos({ customers: [customer({ customerType: 'A_acne', typeConfidence: 0.9 })] });

    const summary = await runCustomerTypeClassification('store-1', repos);

    expect(updateSpy).not.toHaveBeenCalled();
    expect(summary.alreadyClassifiedSkipped).toBe(1);
    expect(summary.classifiedNewly).toBe(0);
  });

  it('単独タイプメニューの来店があれば分類して保存する', async () => {
    const { repos, updateSpy } = createRepos({
      customers: [customer()],
      visits: [visit({ menuId: 'menu-pore' })],
      menus: [menu({ id: 'menu-pore', targetTypes: ['B_pore'] })],
    });

    const summary = await runCustomerTypeClassification('store-1', repos);

    expect(updateSpy).toHaveBeenCalledWith('cust-1', { customerType: 'B_pore', typeConfidence: 1 });
    expect(summary.classifiedNewly).toBe(1);
    expect(summary.results[0].after.customerType).toBe('B_pore');
  });

  it('実信号が無い顧客はnullのまま保存し、stillUnclassifiedに数える', async () => {
    const { repos, updateSpy } = createRepos({ customers: [customer()], visits: [], menus: [] });

    const summary = await runCustomerTypeClassification('store-1', repos);

    expect(updateSpy).toHaveBeenCalledWith('cust-1', { customerType: null, typeConfidence: 0 });
    expect(summary.stillUnclassified).toBe(1);
    expect(summary.classifiedNewly).toBe(0);
  });

  it('本番同等の状態(全顧客NULL・全来店がtargetTypes空)では分類0件になる', async () => {
    const customers = Array.from({ length: 3 }, (_, i) => customer({ id: `cust-${i}`, name: `顧客${i}` }));
    const fallbackMenu = menu({ id: 'fallback', targetTypes: [] });
    const visits = customers.map((c, i) => visit({ id: `v${i}`, customerId: c.id, menuId: 'fallback' }));
    const { repos } = createRepos({ customers, visits, menus: [fallbackMenu] });

    const summary = await runCustomerTypeClassification('store-1', repos);

    expect(summary.classifiedNewly).toBe(0);
    expect(summary.stillUnclassified).toBe(3);
  });
});
