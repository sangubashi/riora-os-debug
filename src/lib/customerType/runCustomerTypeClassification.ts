/**
 * runCustomerTypeClassification.ts — CustomerTypeEngineを店舗の全顧客に適用し、
 * brain_customers.customer_type/type_confidenceへ保存する(Pass H)。
 *
 * 既存のcustomer_typeが既に設定済みの顧客は上書きしない(誰かが正しく設定した値を
 * 壊さないため)。現状は全顧客NULLのため実質全顧客が対象になる。
 */
import { classifyCustomerType } from '../../engines/customerType/CustomerTypeEngine';
import type { ICustomerRepo, IVisitRepo, IMenuRepo } from '../../repositories/interfaces';
import type { UUID } from '../../types/riora.types';

export interface ClassificationRunRepos {
  customerRepo: ICustomerRepo;
  visitRepo: IVisitRepo;
  menuRepo: IMenuRepo;
}

export interface CustomerClassificationResult {
  customerId: UUID;
  customerName: string;
  before: { customerType: string | null };
  after: { customerType: string | null; confidence: number; reason: string };
  saved: boolean;
}

export interface ClassificationRunSummary {
  totalCustomers: number;
  alreadyClassifiedSkipped: number;
  classifiedNewly: number;
  stillUnclassified: number;
  results: CustomerClassificationResult[];
}

export async function runCustomerTypeClassification(storeId: UUID, repos: ClassificationRunRepos): Promise<ClassificationRunSummary> {
  const [customers, visits, menus] = await Promise.all([
    repos.customerRepo.listByStore(storeId),
    repos.visitRepo.listByStore(storeId),
    repos.menuRepo.listByStore(storeId),
  ]);

  const visitsByCustomer = new Map<string, typeof visits>();
  for (const v of visits) {
    const list = visitsByCustomer.get(v.customerId) ?? [];
    list.push(v);
    visitsByCustomer.set(v.customerId, list);
  }

  const results: CustomerClassificationResult[] = [];
  let alreadyClassifiedSkipped = 0;
  let classifiedNewly = 0;

  for (const customer of customers) {
    if (customer.customerType !== null) {
      alreadyClassifiedSkipped += 1;
      results.push({
        customerId: customer.id,
        customerName: customer.name,
        before: { customerType: customer.customerType },
        after: { customerType: customer.customerType, confidence: customer.typeConfidence, reason: 'already_classified' },
        saved: false,
      });
      continue;
    }

    const classification = classifyCustomerType({
      weddingDate: customer.weddingDate,
      visits: visitsByCustomer.get(customer.id) ?? [],
      menus,
    });

    await repos.customerRepo.updateCustomerType(customer.id, {
      customerType: classification.customerType,
      typeConfidence: classification.confidence,
    });

    if (classification.customerType !== null) classifiedNewly += 1;

    results.push({
      customerId: customer.id,
      customerName: customer.name,
      before: { customerType: null },
      after: { customerType: classification.customerType, confidence: classification.confidence, reason: classification.reason },
      saved: true,
    });
  }

  return {
    totalCustomers: customers.length,
    alreadyClassifiedSkipped,
    classifiedNewly,
    stillUnclassified: customers.length - alreadyClassifiedSkipped - classifiedNewly,
    results,
  };
}
