import type { SupabaseClient } from '@supabase/supabase-js';
import type { ScoringWeights } from '../../types/riora.types';
import type { StyleAffinityTable } from '../../types/brain.types';
import type { IParamsRepo } from '../interfaces';
import { toScoringWeights, toStyleAffinityTable } from './mappers';

export class ParamsRepo implements IParamsRepo {
  constructor(private readonly client: SupabaseClient) {}

  async weights(cluster: string): Promise<ScoringWeights> {
    return toScoringWeights(await this.latestValue('fire_score_weights', cluster));
  }

  async styleAffinity(cluster: string): Promise<StyleAffinityTable> {
    return toStyleAffinityTable(await this.latestValue('style_affinity', cluster));
  }

  private async latestValue(key: string, cluster: string): Promise<unknown> {
    const { data, error } = await this.client
      .from('brain_params')
      .select('value')
      .eq('key', key)
      .eq('cluster', cluster)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`ParamsRepo: failed to load ${key} for cluster=${cluster}: ${error.message}`);
    }
    if (!data) {
      throw new Error(`ParamsRepo: no ${key} seeded for cluster=${cluster}`);
    }
    return data.value;
  }
}
