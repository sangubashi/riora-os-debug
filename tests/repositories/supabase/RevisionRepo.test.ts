import { describe, expect, it } from 'vitest';
import { RevisionRepo } from '../../../src/repositories/supabase/RevisionRepo';
import { createSingleTableSupabaseMock, createSupabaseMock, createQueryBuilderMock } from './testUtils';
import type { BrainBrandRevisionRow, BrainPatternRevisionRow } from '../../../src/repositories/supabase/mappers';

const STORE_REVISION_ROW: BrainPatternRevisionRow = {
  id: 'rev-1',
  store_id: 'store-1',
  pattern_id: 'B1',
  change_type: 'timing',
  before: { cooldown_visits: 2 },
  after: { cooldown_visits: 3 },
  evidence: { sample_size: 50 },
  status: 'approved',
  decided_by: 'admin-1',
  decided_at: '2026-06-13T00:00:00Z',
  created_at: '2026-06-01T00:00:00Z',
};

const BRAND_REVISION_ROW: BrainBrandRevisionRow = {
  id: 'rev-2',
  pattern_library_id: 'B2',
  change_type: 'script',
  before: { base_script: 'old' },
  after: { base_script: 'new' },
  evidence: {},
  status: 'approved',
  decided_by: 'admin-2',
  decided_at: '2026-06-13T00:00:00Z',
  created_at: '2026-06-02T00:00:00Z',
};

describe('RevisionRepo', () => {
  describe('approve', () => {
    it('scope=storeの場合はbrain_pattern_revisionsを更新してRevisionRecordを返す', async () => {
      const { client } = createSingleTableSupabaseMock({ data: STORE_REVISION_ROW, error: null });
      const repo = new RevisionRepo(client);

      const result = await repo.approve('store', 'rev-1', 'admin-1');

      expect(result).toEqual({
        id: 'rev-1',
        scope: 'store',
        storeId: 'store-1',
        patternId: 'B1',
        changeType: 'timing',
        before: { cooldown_visits: 2 },
        after: { cooldown_visits: 3 },
        evidence: { sample_size: 50 },
        status: 'approved',
        decidedBy: 'admin-1',
        decidedAt: '2026-06-13T00:00:00Z',
        createdAt: '2026-06-01T00:00:00Z',
      });
    });

    it('scope=brandの場合はbrain_revisionsを更新してstoreId=nullのRevisionRecordを返す', async () => {
      const { client } = createSingleTableSupabaseMock({ data: BRAND_REVISION_ROW, error: null });
      const repo = new RevisionRepo(client);

      const result = await repo.approve('brand', 'rev-2', 'admin-2');

      expect(result).toEqual({
        id: 'rev-2',
        scope: 'brand',
        storeId: null,
        patternId: 'B2',
        changeType: 'script',
        before: { base_script: 'old' },
        after: { base_script: 'new' },
        evidence: {},
        status: 'approved',
        decidedBy: 'admin-2',
        decidedAt: '2026-06-13T00:00:00Z',
        createdAt: '2026-06-02T00:00:00Z',
      });
    });

    it('対象行が存在しない場合はnullを返す', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: null });
      const repo = new RevisionRepo(client);

      const result = await repo.approve('store', 'rev-999', 'admin-1');

      expect(result).toBeNull();
    });

    it('Supabaseがerrorを返した場合はRevisionRepo.approve failedで例外を投げる', async () => {
      const { client } = createSingleTableSupabaseMock({ data: null, error: { message: 'update failed' } });
      const repo = new RevisionRepo(client);

      await expect(repo.approve('store', 'rev-1', 'admin-1')).rejects.toThrow(
        'RevisionRepo.approve failed: update failed'
      );
    });

    it('scope=storeはbrain_pattern_revisionsテーブルを使う', async () => {
      const builder = createQueryBuilderMock({ data: STORE_REVISION_ROW, error: null });
      const client = createSupabaseMock(() => builder);
      const repo = new RevisionRepo(client);

      await repo.approve('store', 'rev-1', 'admin-1');

      expect(client.from).toHaveBeenCalledWith('brain_pattern_revisions');
    });

    it('scope=brandはbrain_revisionsテーブルを使う', async () => {
      const builder = createQueryBuilderMock({ data: BRAND_REVISION_ROW, error: null });
      const client = createSupabaseMock(() => builder);
      const repo = new RevisionRepo(client);

      await repo.approve('brand', 'rev-2', 'admin-2');

      expect(client.from).toHaveBeenCalledWith('brain_revisions');
    });

    it('id・status=proposedでフィルタしstatus=approved/decided_by/decided_atを更新する', async () => {
      const builder = createQueryBuilderMock({ data: STORE_REVISION_ROW, error: null });
      const client = createSupabaseMock(() => builder);
      const repo = new RevisionRepo(client);

      await repo.approve('store', 'rev-1', 'admin-1');

      expect(builder.eq).toHaveBeenCalledWith('id', 'rev-1');
      expect(builder.eq).toHaveBeenCalledWith('status', 'proposed');
      expect(builder.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'approved', decided_by: 'admin-1' })
      );
    });
  });
});
