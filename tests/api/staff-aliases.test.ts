import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '../../app/api/admin/staff-aliases/route';
import { getRepos } from '../../app/lib/repos';
import type { Staff } from '../../src/types/riora.types';

vi.mock('../../app/lib/repos', () => ({ getRepos: vi.fn() }));

const STAFF: Staff = { id: 'staff-1', storeId: 'store-1', name: '鈴木', style: 'evidence', isActive: true, nameAliases: ['すずき'] };

const mockRepos = { staffRepo: { listByStore: vi.fn(), addNameAlias: vi.fn() } };

function buildUrl(qs: string) {
  return new NextRequest(`http://localhost/api/admin/staff-aliases${qs}`);
}

function buildPostReq(body: unknown) {
  return new NextRequest('http://localhost/api/admin/staff-aliases', { method: 'POST', body: JSON.stringify(body) });
}

describe('GET /api/admin/staff-aliases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRepos).mockReturnValue(mockRepos as never);
    mockRepos.staffRepo.listByStore.mockResolvedValue([STAFF]);
  });

  it('スタッフ一覧と登録済みエイリアス一覧を返す', async () => {
    const res = await GET(buildUrl('?storeId=store-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.staffOptions).toEqual([{ id: 'staff-1', name: '鈴木' }]);
    expect(body.aliases).toEqual([{ id: 'staff-1:すずき', alias: 'すずき', staffId: 'staff-1', staffName: '鈴木', createdAt: '', createdBy: '' }]);
  });

  it('Repository factoryがエラーの場合は500を返す', async () => {
    vi.mocked(getRepos).mockImplementation(() => { throw new Error('Supabase env not configured'); });

    const res = await GET(buildUrl('?storeId=store-1'));
    expect(res.status).toBe(500);
  });
});

describe('POST /api/admin/staff-aliases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRepos).mockReturnValue(mockRepos as never);
  });

  it('alias/staffId必須項目が欠けている場合は400(validation_error)を返す', async () => {
    const res = await POST(buildPostReq({ alias: '亀やま' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('validation_error');
    expect(mockRepos.staffRepo.addNameAlias).not.toHaveBeenCalled();
  });

  it('brain_staff.name_aliasesへ追加し、作成結果を返す', async () => {
    mockRepos.staffRepo.addNameAlias.mockResolvedValue(STAFF);

    const res = await POST(buildPostReq({ storeId: 'store-1', alias: 'すずき', staffId: 'staff-1' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.alias).toBe('すずき');
    expect(body.staffId).toBe('staff-1');
    expect(mockRepos.staffRepo.addNameAlias).toHaveBeenCalledWith('staff-1', 'すずき');
  });

  it('対象スタッフが存在しない場合は404(staff_not_found)を返す', async () => {
    mockRepos.staffRepo.addNameAlias.mockResolvedValue(null);

    const res = await POST(buildPostReq({ storeId: 'store-1', alias: 'すずき', staffId: 'staff-missing' }));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('staff_not_found');
  });

  it('不正なJSONの場合は400(invalid_json)を返す', async () => {
    const req = new NextRequest('http://localhost/api/admin/staff-aliases', { method: 'POST', body: '{invalid' });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('invalid_json');
  });
});
