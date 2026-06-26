import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../../app/api/admin/customer-type/classify/route';
import { getRepos } from '../../app/lib/repos';
import * as runModule from '../../src/lib/customerType/runCustomerTypeClassification';
import type { ClassificationRunSummary } from '../../src/lib/customerType/runCustomerTypeClassification';

vi.mock('../../app/lib/repos', () => ({ getRepos: vi.fn() }));

function buildReq(qs: string) {
  return new NextRequest(`http://localhost/api/admin/customer-type/classify${qs}`, { method: 'POST' });
}

const SUMMARY: ClassificationRunSummary = {
  totalCustomers: 40,
  alreadyClassifiedSkipped: 0,
  classifiedNewly: 0,
  stillUnclassified: 40,
  results: [],
};

describe('POST /api/admin/customer-type/classify', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('storeId未指定はvalidation_errorで400', async () => {
    const res = await POST(buildReq(''));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('validation_error');
  });

  it('正常系は200でsummaryを返す', async () => {
    (getRepos as ReturnType<typeof vi.fn>).mockReturnValue({});
    vi.spyOn(runModule, 'runCustomerTypeClassification').mockResolvedValue(SUMMARY);

    const res = await POST(buildReq('?storeId=store-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.summary).toEqual(SUMMARY);
  });

  it('getReposが投げた場合は500', async () => {
    (getRepos as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('repo init failed');
    });

    const res = await POST(buildReq('?storeId=store-1'));
    expect(res.status).toBe(500);
  });

  it('classification実行が投げた場合は500', async () => {
    (getRepos as ReturnType<typeof vi.fn>).mockReturnValue({});
    vi.spyOn(runModule, 'runCustomerTypeClassification').mockRejectedValue(new Error('boom'));

    const res = await POST(buildReq('?storeId=store-1'));
    expect(res.status).toBe(500);
  });
});
