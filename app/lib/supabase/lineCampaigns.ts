import { supabase } from '../supabaseClient';

export type CampaignStatus = 'draft' | 'approved' | 'sent' | 'rejected';

export interface LineCampaign {
  id: string;
  title: string;
  body: string;
  target_tags: string[];
  status: CampaignStatus;
  approved_by: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface CreateCampaignInput {
  title: string;
  body: string;
  target_tags?: string[];
}

export async function createCampaignDraft(input: CreateCampaignInput): Promise<LineCampaign> {
  const { data, error } = await supabase
    .from('line_campaigns')
    .insert({
      title: input.title,
      body: input.body,
      target_tags: input.target_tags ?? [],
      status: 'draft',
    })
    .select()
    .single();

  if (error) throw new Error(`キャンペーン保存失敗: ${error.message}`);
  return data as LineCampaign;
}

export async function fetchCampaignsByStatus(status: CampaignStatus): Promise<LineCampaign[]> {
  const { data, error } = await supabase
    .from('line_campaigns')
    .select('*')
    .eq('status', status)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`キャンペーン取得失敗: ${error.message}`);
  return (data ?? []) as LineCampaign[];
}

export async function approveCampaign(id: string, approvedBy: string): Promise<void> {
  const { error } = await supabase
    .from('line_campaigns')
    .update({ status: 'approved', approved_by: approvedBy })
    .eq('id', id);

  if (error) throw new Error(`承認失敗: ${error.message}`);
}

export async function rejectCampaign(id: string): Promise<void> {
  const { error } = await supabase
    .from('line_campaigns')
    .update({ status: 'rejected' })
    .eq('id', id);

  if (error) throw new Error(`却下失敗: ${error.message}`);
}

export async function updateCampaignMessage(id: string, body: string): Promise<void> {
  const { error } = await supabase
    .from('line_campaigns')
    .update({ body })
    .eq('id', id);

  if (error) throw new Error(`更新失敗: ${error.message}`);
}

export async function deleteCampaign(id: string): Promise<void> {
  const { error } = await supabase
    .from('line_campaigns')
    .delete()
    .eq('id', id);

  if (error) throw new Error(`削除失敗: ${error.message}`);
}
