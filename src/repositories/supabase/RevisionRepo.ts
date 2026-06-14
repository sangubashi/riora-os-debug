import type { SupabaseClient } from '@supabase/supabase-js';
import type { RevisionRecord, RevisionScope, UUID } from '../../types/riora.types';
import type { IRevisionRepo } from '../interfaces';
import { toRevisionRecord, type BrainBrandRevisionRow, type BrainPatternRevisionRow } from './mappers';

const STORE_REVISION_COLUMNS =
  'id, store_id, pattern_id, change_type, before, after, evidence, status, decided_by, decided_at, created_at';
const BRAND_REVISION_COLUMNS =
  'id, pattern_library_id, change_type, before, after, evidence, status, decided_by, decided_at, created_at';

export class RevisionRepo implements IRevisionRepo {
  constructor(private readonly client: SupabaseClient) {}

  async approve(scope: RevisionScope, id: UUID, decidedBy: UUID): Promise<RevisionRecord | null> {
    const table = scope === 'store' ? 'brain_pattern_revisions' : 'brain_revisions';
    const columns = scope === 'store' ? STORE_REVISION_COLUMNS : BRAND_REVISION_COLUMNS;

    const { data, error } = await this.client
      .from(table)
      .update({ status: 'approved', decided_by: decidedBy, decided_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'proposed')
      .select(columns)
      .maybeSingle();

    if (error) {
      throw new Error(`RevisionRepo.approve failed: ${error.message}`);
    }
    if (!data) return null;

    return scope === 'store'
      ? toRevisionRecord(data as unknown as BrainPatternRevisionRow, scope)
      : toRevisionRecord(data as unknown as BrainBrandRevisionRow, scope);
  }
}
