import { supabase, DEMO_MODE } from './supabase';
import type { LineCampaign, CampaignStatus } from '../types';

export async function fetchCampaigns(status?: CampaignStatus): Promise<LineCampaign[]> {
  if (DEMO_MODE) return [];

  let query = supabase
    .from('line_campaigns')
    .select('*')
    .order('created_at', { ascending: false });

  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as LineCampaign[];
}

export async function approveCampaign(id: string): Promise<void> {
  if (DEMO_MODE) return;

  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('line_campaigns')
    .update({ status: 'approved', approved_by: user?.id || null })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function updateCampaignMessage(id: string, body: string): Promise<void> {
  if (DEMO_MODE) return;

  const { error } = await supabase
    .from('line_campaigns')
    .update({ body })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteCampaign(id: string): Promise<void> {
  if (DEMO_MODE) return;

  const { error } = await supabase
    .from('line_campaigns')
    .delete()
    .eq('id', id);
  if (error) throw new Error(error.message);
}

