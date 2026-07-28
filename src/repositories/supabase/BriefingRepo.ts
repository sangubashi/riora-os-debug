import type { SupabaseClient } from '@supabase/supabase-js';
import type { BriefingEntry, ProposalKind, UUID } from '../../types/riora.types';
import type {
  AttachFireLogFeedbackInput,
  AttachFireLogFeedbackResult,
  FireLogFeedbackRow,
  IBriefingRepo,
} from '../interfaces';
import { toBriefingEntry, type BrainFireLogRow } from './mappers';

/**
 * decision_record(jsonb)にPhase 1-Ba以降、素通しで追加保存されてきたフィールドの
 * 読み取り用型。BriefingEntry.decisionRecordの公称型(DecisionRecord)には含まれない
 * ため、ここでのみ緩く型付けして読み出す(recordProposalOutcome.tsと同じ方式)。
 */
interface FireLogDecisionRecordShape {
  patternId?: string | null;
  stepNo?: number | null;
  proposalKind?: string | null;
  staffFeedback?: { value?: string; staffId?: string; at?: string } | null;
}

const FIRE_LOG_COLUMNS = 'id, customer_id, visit_id, decision_record, explanation, created_at';

/**
 * listWithStaffFeedback()の既定取得上限(AI提案学習Phase2.5)。Supabase/PostgRESTの
 * 暗黙のdefault max_rows(通常1000)に依存せず、明示的な上限を持たせるための値。
 * 呼び出し側がAPIで期間('30d'/'90d')を絞ればこの上限に達する可能性は低いが、
 * 'all'選択時の安全弁として機能する。
 */
const FIRE_LOG_FEEDBACK_DEFAULT_LIMIT = 5000;

export class BriefingRepo implements IBriefingRepo {
  constructor(private readonly client: SupabaseClient) {}

  async latestByCustomer(customerId: UUID): Promise<BriefingEntry | null> {
    const { data: fireLog, error: fireLogError } = await this.client
      .from('brain_pattern_fire_log')
      .select(FIRE_LOG_COLUMNS)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fireLogError) {
      throw new Error(`BriefingRepo.latestByCustomer failed: ${fireLogError.message}`);
    }
    if (!fireLog) return null;

    const { data: customer, error: customerError } = await this.client
      .from('brain_customers')
      .select('name')
      .eq('id', customerId)
      .maybeSingle();

    if (customerError) {
      throw new Error(`BriefingRepo.latestByCustomer failed: ${customerError.message}`);
    }

    const customerName = (customer as { name: string } | null)?.name ?? '';
    return toBriefingEntry(fireLog as unknown as BrainFireLogRow, customerName);
  }

  async insert(input: {
    storeId: UUID; customerId: UUID; visitId: UUID | null;
    decisionRecord: Record<string, unknown>; explanation: string;
  }): Promise<BriefingEntry> {
    const { data, error } = await this.client
      .from('brain_pattern_fire_log')
      .insert({
        store_id: input.storeId,
        customer_id: input.customerId,
        visit_id: input.visitId,
        decision_record: input.decisionRecord,
        explanation: input.explanation,
      })
      .select(FIRE_LOG_COLUMNS)
      .single();

    if (error) {
      throw new Error(`BriefingRepo.insert failed: ${error.message}`);
    }

    const { data: customer, error: customerError } = await this.client
      .from('brain_customers')
      .select('name')
      .eq('id', input.customerId)
      .maybeSingle();

    if (customerError) {
      throw new Error(`BriefingRepo.insert failed: ${customerError.message}`);
    }

    const customerName = (customer as { name: string } | null)?.name ?? '';
    return toBriefingEntry(data as unknown as BrainFireLogRow, customerName);
  }

  async recentByCustomer(customerId: UUID, n: number): Promise<BriefingEntry[]> {
    const { data, error } = await this.client
      .from('brain_pattern_fire_log')
      .select(FIRE_LOG_COLUMNS)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(n);

    if (error) {
      throw new Error(`BriefingRepo.recentByCustomer failed: ${error.message}`);
    }
    return ((data ?? []) as unknown as BrainFireLogRow[]).map((row) => toBriefingEntry(row, ''));
  }

  async attachFeedback(fireLogId: UUID, input: AttachFireLogFeedbackInput): Promise<AttachFireLogFeedbackResult> {
    const { data: existing, error: selectError } = await this.client
      .from('brain_pattern_fire_log')
      .select('id, store_id, decision_record')
      .eq('id', fireLogId)
      .maybeSingle();

    if (selectError) {
      throw new Error(`BriefingRepo.attachFeedback failed: ${selectError.message}`);
    }
    if (!existing) return { attached: false, reason: 'not_found' };

    const row = existing as { store_id: string; decision_record: Record<string, unknown> | null };
    if (row.store_id !== input.storeId) return { attached: false, reason: 'store_mismatch' };

    const decisionRecord = row.decision_record ?? {};
    if (decisionRecord.staffFeedback) return { attached: false, reason: 'already_has_feedback' };

    const nextDecisionRecord = {
      ...decisionRecord,
      staffFeedback: { value: input.feedback, staffId: input.staffId, at: new Date().toISOString() },
    };

    // decision_record->staffFeedback IS NULLを条件に含めることで、SELECTとUPDATEの間の
    // 競合(二重タップ等)を防ぐ(UNIQUE制約を持つ新規テーブルを追加しない代わりの防御)。
    const { data: updated, error: updateError } = await this.client
      .from('brain_pattern_fire_log')
      .update({ decision_record: nextDecisionRecord })
      .eq('id', fireLogId)
      .is('decision_record->staffFeedback', null)
      .select('id');

    if (updateError) {
      throw new Error(`BriefingRepo.attachFeedback failed: ${updateError.message}`);
    }
    if (!updated || updated.length === 0) return { attached: false, reason: 'already_has_feedback' };
    return { attached: true };
  }

  async listWithStaffFeedback(storeId: UUID, options?: { sinceIso?: string | null; limit?: number }): Promise<FireLogFeedbackRow[]> {
    // Phase2.5: created_at降順+limitを必ず指定する(store_idにインデックスが無いため
    // スキャン量そのものは変わらないが、返却件数の上限を明示することでアプリ側の
    // メモリ/レスポンスサイズを保護し、Supabase/PostgRESTの暗黙のdefault max_rowsに
    // 依存しない挙動にする)。
    const limit = options?.limit ?? FIRE_LOG_FEEDBACK_DEFAULT_LIMIT;
    let query = this.client
      .from('brain_pattern_fire_log')
      .select('id, decision_record, created_at')
      .eq('store_id', storeId)
      .not('decision_record->staffFeedback', 'is', null)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (options?.sinceIso) {
      query = query.gte('created_at', options.sinceIso);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`BriefingRepo.listWithStaffFeedback failed: ${error.message}`);
    }

    const rows: FireLogFeedbackRow[] = [];
    for (const row of (data ?? []) as { id: string; decision_record: Record<string, unknown>; created_at: string }[]) {
      const dr = row.decision_record as unknown as FireLogDecisionRecordShape;
      const fb = dr.staffFeedback;
      if (!dr.patternId || dr.stepNo == null || !dr.proposalKind || !fb?.value || !fb.staffId) continue;
      if (fb.value !== 'good' && fb.value !== 'bad') continue;

      rows.push({
        fireLogId: row.id,
        patternId: dr.patternId,
        stepNo: dr.stepNo,
        proposalKind: dr.proposalKind as ProposalKind,
        feedback: fb.value,
        staffId: fb.staffId,
        feedbackAt: fb.at ?? row.created_at,
        createdAt: row.created_at,
      });
    }
    return rows;
  }
}
