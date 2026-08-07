import type { SupabaseClient } from '@supabase/supabase-js';
import type { CellKey, CellStats, PatternStepStatSummary } from '../../types/riora.types';
import type { IStatsRepo } from '../interfaces';
import { cellKeyOf, toCellStats, toPatternStepStatSummary, type PatternStepStatFullRow, type PatternStepStatsRow } from './mappers';

export class StatsRepo implements IStatsRepo {
  constructor(private readonly client: SupabaseClient) {}

  async loadCells(keys: CellKey[]): Promise<Map<CellKey, CellStats>> {
    const result = new Map<CellKey, CellStats>();
    if (keys.length === 0) return result;

    // CellKey = `${candidateCode}:${customerType}:${staffStyle}`。
    // 1顧客×1スタッフの評価内ではcustomerType/staffStyleは共通のため、
    // candidate_codeのみIN句にまとめ1クエリで取得する(性能予算: IN句1クエリ)。
    const [, customerType, staffStyle] = keys[0].split(':');
    const candidateCodes = Array.from(new Set(keys.map((key) => key.split(':')[0])));

    const { data, error } = await this.client
      .from('brain_pattern_step_stats')
      .select('candidate_code, customer_type, staff_style, executed_n, accepted_n, laplace_rate, repeat_rate_90d')
      .in('candidate_code', candidateCodes)
      .eq('customer_type', customerType)
      .eq('staff_style', staffStyle);

    if (error) {
      throw new Error(`StatsRepo.loadCells failed: ${error.message}`);
    }

    for (const row of (data ?? []) as PatternStepStatsRow[]) {
      result.set(cellKeyOf(row), toCellStats(row));
    }
    return result;
  }

  async refreshStepStats(): Promise<void> {
    const { error } = await this.client.rpc('refresh_pattern_step_stats');
    if (error) {
      throw new Error(`StatsRepo.refreshStepStats failed: ${error.message}`);
    }
  }

  async listAllStepStats(): Promise<PatternStepStatSummary[]> {
    // brain_pattern_step_statsにstore_id列が無いため店舗絞り込みは行わない
    // (単一店舗運用の現状では実害なし、IStatsRepo.listAllStepStatsのコメント参照)。
    const { data, error } = await this.client
      .from('brain_pattern_step_stats')
      .select('candidate_code, pattern_id, step_no, customer_type, staff_style, executed_n, accepted_n, laplace_rate, repeat_rate_90d, avg_fire_score')
      .order('executed_n', { ascending: false });

    if (error) {
      throw new Error(`StatsRepo.listAllStepStats failed: ${error.message}`);
    }
    return ((data ?? []) as PatternStepStatFullRow[]).map(toPatternStepStatSummary);
  }
}
