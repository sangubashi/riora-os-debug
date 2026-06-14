// ================================================================
// P0 API Layer v1.0: Repository Factory
//
// app/api/** はこのファイル経由でのみRepositoryへアクセスする。
// Supabase Client生成・Engine呼び出しはここに集約し、APIルートからは
// @supabase/supabase-js / src/engines/** を直接importしない。
// ================================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  IBriefingRepo,
  ICustomerRepo,
  IDashboardRepo,
  ILineQueueRepo,
  IRevisionRepo,
  IVisitRepo,
} from '@/repositories/interfaces';
import { BriefingRepo } from '@/repositories/supabase/BriefingRepo';
import { CustomerRepo } from '@/repositories/supabase/CustomerRepo';
import { DashboardRepo } from '@/repositories/supabase/DashboardRepo';
import { LineQueueRepo } from '@/repositories/supabase/LineQueueRepo';
import { RevisionRepo } from '@/repositories/supabase/RevisionRepo';
import { VisitRepo } from '@/repositories/supabase/VisitRepo';

export interface Repos {
  customerRepo: ICustomerRepo;
  visitRepo: IVisitRepo;
  lineQueueRepo: ILineQueueRepo;
  dashboardRepo: IDashboardRepo;
  briefingRepo: IBriefingRepo;
  revisionRepo: IRevisionRepo;
}

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (client) return client;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase env not configured (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
  }

  client = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  return client;
}

export function getRepos(): Repos {
  const supabase = getClient();
  return {
    customerRepo: new CustomerRepo(supabase),
    visitRepo: new VisitRepo(supabase),
    lineQueueRepo: new LineQueueRepo(supabase),
    dashboardRepo: new DashboardRepo(supabase),
    briefingRepo: new BriefingRepo(supabase),
    revisionRepo: new RevisionRepo(supabase),
  };
}
