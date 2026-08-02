import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getRepos } from '../../app/lib/repos';
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest';
import { canAccessCustomer } from '@/lib/auth/canAccessCustomer';

vi.mock('../../app/lib/repos', () => ({ getRepos: vi.fn() }));
vi.mock('@/lib/auth/extractStaffFromRequest', () => ({ extractStaffFromRequest: vi.fn() }));
vi.mock('@/lib/auth/canAccessCustomer', () => ({ canAccessCustomer: vi.fn() }));

// route.tsはANTHROPIC_API_KEYをモジュールトップレベルの定数として1度だけ読む
// (関数内で都度読むline-message routeとは異なるパターン)。beforeEachでの
// process.env設定より前に静的importでモジュールが評価されてしまうと定数が
// 永久にundefinedになるため、env設定後に動的importする。
let POST: typeof import('../../app/api/customers/[id]/homecare-message/route').POST;
beforeAll(async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  ({ POST } = await import('../../app/api/customers/[id]/homecare-message/route'));
});

const STAFF = {
  authUserId: 'staff-auth-uid', staffBrainId: 'staff-id',
  email: 'staff@example.com', isAdmin: false,
};

const CUSTOMER_ID = '11111111-1111-1111-1111-111111111111';

const mockRepos = {
  menuRepo: { findById: vi.fn() },
};

const MENU = {
  id: 'menu-1', storeId: 'store-1', name: 'ハーブピーリング', price: 12000, role: 'peeling', targetTypes: [],
  durationMinutes: 60, skinConcernTags: ['毛穴'], expectedEffects: ['引き締め'], recommendedCycleDays: 28,
  contraindicationTags: ['妊娠中'], recommendedHomecareProducts: ['美容液'], aiTags: ['毛穴', 'ピーリング'],
};

function buildReq(body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/customers/${CUSTOMER_ID}/homecare-message`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function callRoute(body: unknown) {
  return POST(buildReq(body), { params: Promise.resolve({ id: CUSTOMER_ID }) });
}

function lastPromptSentToClaude(): string {
  const call = vi.mocked(fetch).mock.calls.find(c => c[0] === 'https://api.anthropic.com/v1/messages');
  const body = JSON.parse((call?.[1] as RequestInit).body as string) as { messages: { content: string }[] };
  return body.messages[0].content;
}

const VALID_BODY = { productName: '美容液A', lastPurchasedAt: '2026-07-01', daysSincePurchase: 30, customerName: '山田様' };

describe('POST /api/customers/[id]/homecare-message', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRepos).mockReturnValue(mockRepos as never);
    vi.mocked(extractStaffFromRequest).mockResolvedValue(STAFF as never);
    vi.mocked(canAccessCustomer).mockResolvedValue(true);
    mockRepos.menuRepo.findById.mockResolvedValue(null);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'フォローメッセージです' }] }),
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('正常系: 生成したメッセージを返す(menuId未指定・既存挙動)', async () => {
    const res = await callRoute(VALID_BODY);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, message: 'フォローメッセージです' });
    expect(mockRepos.menuRepo.findById).not.toHaveBeenCalled();
    expect(lastPromptSentToClaude()).not.toContain('Menu AI Context');
  });

  it('必須項目が欠落している場合は400を返す', async () => {
    const res = await callRoute({ productName: '美容液A' });
    expect(res.status).toBe(400);
  });

  it('未認証の場合は401を返す', async () => {
    vi.mocked(extractStaffFromRequest).mockResolvedValue(null);
    const res = await callRoute(VALID_BODY);
    expect(res.status).toBe(401);
  });

  it('アクセス権のない顧客の場合は403を返す', async () => {
    vi.mocked(canAccessCustomer).mockResolvedValue(false);
    const res = await callRoute(VALID_BODY);
    expect(res.status).toBe(403);
  });

  // 注: ANTHROPIC_API_KEY未設定時の503は、route.tsがモジュールトップレベルの
  // 定数として起動時に1度だけ読む設計のため、実行中にprocess.envを書き換えても
  // 再現できない(line-message routeのような関数内での都度読み込みとは異なる)。
  // 本テストファイルでは対象外とする。

  describe('PHASE MENU-AI-3: Menu AI Context', () => {
    it('menuIdが解決できる場合、プロンプト末尾にMenu AI Contextを追記する', async () => {
      mockRepos.menuRepo.findById.mockResolvedValue(MENU);
      const res = await callRoute({ ...VALID_BODY, menuId: 'menu-1' });

      expect(res.status).toBe(200);
      expect(mockRepos.menuRepo.findById).toHaveBeenCalledWith('menu-1');

      const prompt = lastPromptSentToClaude();
      expect(prompt).toContain('Menu AI Context');
      expect(prompt).toContain('- category: peeling');
      expect(prompt).toContain('- aiTags: 毛穴・ピーリング');
      expect(prompt).toContain('- priceBand: ¥10,000〜¥15,000');
      // 許可リスト外(name/skinConcernTags/expectedEffects)は渡さない
      // (recommendedHomecareProductsの'美容液'はproductNameの'美容液A'と部分一致して
      // しまうため、ここでは検証対象から除外する)
      expect(prompt).not.toContain('ハーブピーリング');
      expect(prompt).not.toContain('引き締め');
    });

    it('menuIdを指定しても該当メニューが無い場合はエラーにせず、Menu AI Contextなしで生成する(④)', async () => {
      mockRepos.menuRepo.findById.mockResolvedValue(null);
      const res = await callRoute({ ...VALID_BODY, menuId: 'missing-menu' });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(lastPromptSentToClaude()).not.toContain('Menu AI Context');
    });

    it('menuRepo.findByIdが例外を投げてもエラーにせず、Menu AI Contextなしで生成する(④)', async () => {
      mockRepos.menuRepo.findById.mockRejectedValue(new Error('db down'));
      const res = await callRoute({ ...VALID_BODY, menuId: 'menu-1' });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(lastPromptSentToClaude()).not.toContain('Menu AI Context');
    });
  });
});
