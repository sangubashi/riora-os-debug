import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../../app/api/customers/[id]/line-message/route';
import { getRepos } from '../../app/lib/repos';
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest';
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer';

vi.mock('../../app/lib/repos', () => ({ getRepos: vi.fn() }));
vi.mock('@/lib/auth/extractStaffFromRequest', () => ({ extractStaffFromRequest: vi.fn() }));
vi.mock('@/lib/auth/canAccessCustomer', () => ({ canAccessCustomer: vi.fn() }));

const STAFF = {
  authUserId: 'staff-auth-uid', staffBrainId: 'staff-id',
  email: 'staff@example.com', isAdmin: false,
};

const CUSTOMER_ID = '11111111-1111-1111-1111-111111111111';

const mockRepos = {
  blogArticleRepo: {
    listApprovedByKeywords:   vi.fn(),
    listApprovedByCategories: vi.fn(),
    listApprovedByProducts:   vi.fn(),
  },
};

function buildReq(body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/customers/${CUSTOMER_ID}/line-message`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function callRoute(body: unknown) {
  return POST(buildReq(body), { params: Promise.resolve({ id: CUSTOMER_ID }) });
}

describe('POST /api/customers/[id]/line-message', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-key';
    vi.mocked(getRepos).mockReturnValue(mockRepos as never);
    vi.mocked(extractStaffFromRequest).mockResolvedValue(STAFF as never);
    vi.mocked(canAccessCustomer).mockResolvedValue(true);
    mockRepos.blogArticleRepo.listApprovedByKeywords.mockResolvedValue([]);
    mockRepos.blogArticleRepo.listApprovedByCategories.mockResolvedValue([]);
    mockRepos.blogArticleRepo.listApprovedByProducts.mockResolvedValue([]);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: '生成されたLINE文面です' }] }),
    })));
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    vi.unstubAllGlobals();
  });

  it('正常系: 生成した文面とreasonsを返す(送信は行わない。LINE APIは呼ばれない)', async () => {
    const res = await callRoute({ customerName: '山田様', skinTags: ['乾燥'], recentVisits: [], homecareProducts: [], recentNoteSummaries: [] });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, message: '生成されたLINE文面です', reasons: [] });
    // Anthropic以外のURL(LINE Messaging API等)へは一切fetchしない
    const calledUrls = vi.mocked(fetch).mock.calls.map(c => c[0]);
    expect(calledUrls).toEqual(['https://api.anthropic.com/v1/messages']);
  });

  it('生成理由(reasons)にタグ・カテゴリ・その他一致のみを含める(記事タイトル・summary等は含まれない)', async () => {
    mockRepos.blogArticleRepo.listApprovedByKeywords.mockResolvedValue([
      { id: 'a1', title: '記事A', sourceUrl: 'https://x', products: [], keywords: ['乾燥'], isCustomerSafe: true, status: 'approved', publishedAt: null, createdAt: '', category: null, summary: '内部メモ' },
    ]);
    mockRepos.blogArticleRepo.listApprovedByCategories.mockResolvedValue([
      { id: 'a2', title: '記事B', sourceUrl: 'https://y', products: [], keywords: [], isCustomerSafe: true, status: 'approved', publishedAt: null, createdAt: '', category: 'クリーム系', summary: '内部メモ2' },
    ]);
    mockRepos.blogArticleRepo.listApprovedByProducts.mockResolvedValue([
      { id: 'a3', title: '記事C', sourceUrl: 'https://z', products: ['保湿クリームA'], keywords: [], isCustomerSafe: true, status: 'approved', publishedAt: null, createdAt: '', category: null, summary: '内部メモ3' },
    ]);

    const res = await callRoute({
      customerName: '山田様',
      skinTags: ['乾燥'],
      recentVisits: [{ menuName: 'フェイシャル', visitDate: '2026-07-01' }],
      homecareProducts: [{ productName: '保湿クリームA', lastPurchasedAt: '2026-07-01' }],
      recentNoteSummaries: [],
    });
    const body = await res.json();

    expect(body.reasons.map((r: { label: string }) => r.label)).toEqual([
      '乾燥タグ一致',
      'クリーム系カテゴリ一致',
      '関連記事一致',
      'ホームケア商品一致',
      '前回施術一致',
      '購入履歴一致',
    ]);
    // scoreは内部利用のみだが構造としては必ず数値で含まれる
    for (const r of body.reasons) expect(typeof r.score).toBe('number');
    // 記事タイトル・summaryはレスポンスのどこにも含まれない
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('記事A');
    expect(raw).not.toContain('内部メモ');
  });

  it('customerNameが無い場合は400を返す', async () => {
    const res = await callRoute({});
    expect(res.status).toBe(400);
  });

  it('未認証の場合は401を返す', async () => {
    vi.mocked(extractStaffFromRequest).mockResolvedValue(null);
    const res = await callRoute({ customerName: '山田様' });
    expect(res.status).toBe(401);
  });

  it('アクセス権のない顧客の場合は403を返す', async () => {
    vi.mocked(canAccessCustomer).mockResolvedValue(false);
    const res = await callRoute({ customerName: '山田様' });
    expect(res.status).toBe(403);
  });

  it('不正なJSONの場合は400を返す', async () => {
    const req = new NextRequest(`http://localhost/api/customers/${CUSTOMER_ID}/line-message`, {
      method: 'POST',
      body: '{invalid',
    });
    const res = await POST(req, { params: Promise.resolve({ id: CUSTOMER_ID }) });
    expect(res.status).toBe(400);
  });

  it('ANTHROPIC_API_KEY未設定の場合は503(generation_failed)を返す', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await callRoute({ customerName: '山田様' });
    expect(res.status).toBe(503);
  });

  it('関連記事の一致検索が失敗しても生成自体は続行する(reasonsは空になる)', async () => {
    mockRepos.blogArticleRepo.listApprovedByKeywords.mockRejectedValue(new Error('db down'));
    const res = await callRoute({ customerName: '山田様', skinTags: ['乾燥'] });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.reasons).toEqual([]);
  });
});
