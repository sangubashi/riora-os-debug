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
  IBusinessSettingsRepo,
  ICandidateRepo,
  ICustomerRepo,
  IDashboardRepo,
  ILineQueueRepo,
  IMenuRepo,
  IOccupancyRepo,
  IOpsLogRepo,
  IOutcomeRepo,
  IParamsRepo,
  IRevisionRepo,
  IStaffRepo,
  IStatsRepo,
  IStoreRepo,
  ISubscriptionRepo,
  IVisitRepo,
} from '@/repositories/interfaces';
import { BriefingRepo } from '@/repositories/supabase/BriefingRepo';
import { BusinessSettingsRepo } from '@/repositories/supabase/BusinessSettingsRepo';
import { CandidateRepo } from '@/repositories/supabase/CandidateRepo';
import { CustomerRepo } from '@/repositories/supabase/CustomerRepo';
import { DashboardRepo } from '@/repositories/supabase/DashboardRepo';
import { LineQueueRepo } from '@/repositories/supabase/LineQueueRepo';
import { MenuRepo } from '@/repositories/supabase/MenuRepo';
import { OccupancyRepo } from '@/repositories/supabase/OccupancyRepo';
import { OpsLogRepo } from '@/repositories/supabase/OpsLogRepo';
import { OutcomeRepo } from '@/repositories/supabase/OutcomeRepo';
import { ParamsRepo } from '@/repositories/supabase/ParamsRepo';
import { RevisionRepo } from '@/repositories/supabase/RevisionRepo';
import { StaffRepo } from '@/repositories/supabase/StaffRepo';
import { StatsRepo } from '@/repositories/supabase/StatsRepo';
import { StoreRepo } from '@/repositories/supabase/StoreRepo';
import { SubscriptionRepo } from '@/repositories/supabase/SubscriptionRepo';
import { VisitRepo } from '@/repositories/supabase/VisitRepo';

export interface Repos {
  customerRepo: ICustomerRepo;
  visitRepo: IVisitRepo;
  lineQueueRepo: ILineQueueRepo;
  dashboardRepo: IDashboardRepo;
  briefingRepo: IBriefingRepo;
  revisionRepo: IRevisionRepo;
  staffRepo: IStaffRepo;
  menuRepo: IMenuRepo;
  opsLogRepo: IOpsLogRepo;
  storeRepo: IStoreRepo;
  businessSettingsRepo: IBusinessSettingsRepo;
  subscriptionRepo: ISubscriptionRepo;
  occupancyRepo: IOccupancyRepo;
  /** AI提案エンジン(ProposalOrchestrator)向け(AI提案本物化タスクで追加)。 */
  candidateRepo: ICandidateRepo;
  statsRepo: IStatsRepo;
  paramsRepo: IParamsRepo;
  outcomeRepo: IOutcomeRepo;
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

/**
 * 生のSupabaseClientを返す(AI提案本物化タスクで追加)。レガシー`customers`系
 * テーブル(customer_notes/booking_prompts/handover_notes/contraindications。
 * brain_*とは別ID空間)への橋渡しクエリ専用。I*Repo/interfaces.tsの対象範囲外の
 * 一時的なクロススキーマ参照のためここに置く(新規Repositoryクラスは作らない)。
 */
export function getServiceClient(): SupabaseClient {
  return getClient();
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
    staffRepo: new StaffRepo(supabase),
    menuRepo: new MenuRepo(supabase),
    opsLogRepo: new OpsLogRepo(supabase),
    storeRepo: new StoreRepo(supabase),
    businessSettingsRepo: new BusinessSettingsRepo(supabase),
    subscriptionRepo: new SubscriptionRepo(supabase),
    occupancyRepo: new OccupancyRepo(supabase),
    candidateRepo: new CandidateRepo(supabase),
    statsRepo: new StatsRepo(supabase),
    paramsRepo: new ParamsRepo(supabase),
    outcomeRepo: new OutcomeRepo(supabase),
  };
}
