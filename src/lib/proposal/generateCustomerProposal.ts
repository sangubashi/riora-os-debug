/**
 * generateCustomerProposal.ts — 顧客詳細からのAI提案生成(AI提案本物化)
 *
 * 設計根拠:
 *   - docs/ai/Riora_Proposal_Generator_Architecture_v2.0.md(ProposalOrchestrator)
 *   - docs/ai/Riora_SuccessPattern_Final_Architecture_v1.0.md(PatternMatcher/Scorer/ConflictResolver)
 *
 * 実データ(brain_customers/brain_visits/brain_success_patterns等)のみを使用し、
 * ProposalOrchestrator(既存・実装済)を実際に呼び出す。LLMは一切使用しない
 * (決定論ルールのみ)。
 *
 * 音声メモ解析(customer_notes/booking_prompts/handover_notes/contraindications)は
 * 旧`customers`テーブル(brain_*とは別ID空間)を参照するため、本ファイルでは
 * 顧客氏名の完全一致(実データ)でのみ橋渡しする(架空のID紐付けは行わない・
 * 一致候補が0件/複数件の場合はその実情をそのまま返す)。
 *
 * LINE履歴はbrain_line_send_queue(brain_customers.idと同一ID空間・実データ)を
 * そのまま使う(line_user_idsは旧customers側のため対象外。調査済み・完成レポート参照)。
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ICandidateRepo, ICustomerRepo, ILineQueueRepo, IOutcomeRepo, IParamsRepo,
  IStaffRepo, IStatsRepo, IStoreRepo, ISubscriptionRepo, IVisitRepo,
} from '../../repositories/interfaces';
import type { FinalProposalSet, EngineDegradedResult, PatternContext, Overrides, StaffAdjustment } from '../../types/riora.types';
import { buildPatternContext } from '../../engines/pattern/PatternContextBuilder';
import { generateHomeCareNote } from '../../engines/pattern/HomeCareGenerator';
import { JsonLogicEvaluator } from '../../engines/pattern/JsonLogicEvaluator';
import { PatternMatcher } from '../../engines/pattern/PatternMatcher';
import { PatternScorer } from '../../engines/pattern/PatternScorer';
import { ConflictResolver } from '../../engines/pattern/ConflictResolver';
import { StaffAdjustmentEngine } from '../../engines/pattern/StaffAdjustmentEngine';
import { ProposalOrchestrator } from '../../engines/pattern/ProposalOrchestrator';

export interface ProposalGenerationRepos {
  customerRepo: ICustomerRepo;
  visitRepo: IVisitRepo;
  staffRepo: IStaffRepo;
  subscriptionRepo: ISubscriptionRepo;
  outcomeRepo: IOutcomeRepo;
  candidateRepo: ICandidateRepo;
  paramsRepo: IParamsRepo;
  statsRepo: IStatsRepo;
  storeRepo: IStoreRepo;
  lineQueueRepo: ILineQueueRepo;
}

export interface VoiceMemoContext {
  /** 旧customersテーブルとの橋渡し状況(架空のIDで繋がない・実情をそのまま開示する)。 */
  linkStatus: 'matched' | 'no_match' | 'ambiguous_match';
  legacyCustomerId: string | null;
  customerNotes: { category: string; note: string; createdAt: string }[];
  contraindications: { severity: string; title: string; description: string | null }[];
  latestBookingPromptSummary: string | null;
  latestHandoverSummary: string | null;
}

export interface LineHistoryContext {
  recentCount: number;
  items: { scenarioCode: string; approvalStatus: string; createdAt: string }[];
}

export type GenerateCustomerProposalResult =
  | {
      ok: true;
      proposal: FinalProposalSet | EngineDegradedResult;
      context: PatternContext;
      voiceMemoContext: VoiceMemoContext;
      lineHistoryContext: LineHistoryContext;
    }
  | { ok: false; reason: 'customer_not_found' | 'staff_not_found' | 'no_customer_type' | 'no_visit_history' };

const HISTORY_LIMIT = 200;

/** 旧customersテーブルへ顧客氏名の完全一致で橋渡しする(実データのみ・架空のID紐付けは行わない)。 */
async function fetchVoiceMemoContext(legacyClient: SupabaseClient | null, customerName: string): Promise<VoiceMemoContext> {
  const empty: VoiceMemoContext = {
    linkStatus: 'no_match', legacyCustomerId: null, customerNotes: [], contraindications: [],
    latestBookingPromptSummary: null, latestHandoverSummary: null,
  };
  if (!legacyClient) return empty;

  const { data: matches, error: matchError } = await legacyClient
    .from('customers')
    .select('id')
    .eq('name', customerName);
  if (matchError || !matches || matches.length === 0) return empty;
  if (matches.length > 1) return { ...empty, linkStatus: 'ambiguous_match' };

  const legacyCustomerId = (matches[0] as { id: string }).id;

  const [{ data: notes }, { data: contraindications }, { data: bookingPrompt }, { data: handover }] = await Promise.all([
    legacyClient.from('customer_notes').select('note, created_at').eq('customer_id', legacyCustomerId).order('created_at', { ascending: false }).limit(10),
    legacyClient.from('contraindications').select('severity, title, description').eq('customer_id', legacyCustomerId),
    legacyClient.from('booking_prompts').select('summary').eq('customer_id', legacyCustomerId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    legacyClient.from('handover_notes').select('summary').eq('customer_id', legacyCustomerId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);

  return {
    linkStatus: 'matched',
    legacyCustomerId,
    customerNotes: (notes ?? []).map((n: { note: string; created_at: string }) => ({ category: '', note: n.note, createdAt: n.created_at })),
    contraindications: (contraindications ?? []).map((c: { severity: string; title: string; description: string | null }) => c),
    latestBookingPromptSummary: (bookingPrompt as { summary: string } | null)?.summary ?? null,
    latestHandoverSummary: (handover as { summary: string } | null)?.summary ?? null,
  };
}

export interface GenerateCustomerProposalInput {
  storeId: string;
  customerId: string;
  staffId: string;
  nowJst?: string;
  /** 旧customersテーブルへの橋渡し用(省略時は音声メモ連携を行わずno_matchを返す)。 */
  legacyClient?: SupabaseClient;
}

export async function generateCustomerProposal(
  input: GenerateCustomerProposalInput,
  repos: ProposalGenerationRepos
): Promise<GenerateCustomerProposalResult> {
  const nowJst = input.nowJst ?? new Date().toISOString();

  const [customer, visits, staffList, subscriptions, recentOutcomes, candidates, store, lineHistory] = await Promise.all([
    repos.customerRepo.findById(input.customerId),
    repos.visitRepo.recentByCustomer(input.customerId, HISTORY_LIMIT),
    repos.staffRepo.listByStore(input.storeId),
    repos.subscriptionRepo.listByStore(input.storeId),
    repos.outcomeRepo.recent(input.customerId, 20),
    repos.candidateRepo.loadActive(input.storeId),
    repos.storeRepo.findById(input.storeId),
    repos.lineQueueRepo.recentByCustomer(input.customerId, 10),
  ]);

  if (!customer) return { ok: false, reason: 'customer_not_found' };
  const staff = staffList.find((s) => s.id === input.staffId);
  if (!staff) return { ok: false, reason: 'staff_not_found' };

  const customerSubscription = subscriptions.find((s) => s.customerId === input.customerId) ?? null;

  const builtContext = buildPatternContext(
    { customer, visits, skinRecords: [], progress: null, subscription: customerSubscription, recentOutcomes, staff, todaysBookings: [], nowJst },
    nowJst
  );
  if (!builtContext.ok) return { ok: false, reason: builtContext.reason };
  const ctx = builtContext.context;

  const weights = await repos.paramsRepo.weights(store?.cluster ?? 'office_area');
  const styleAffinity = await repos.paramsRepo.styleAffinity(store?.cluster ?? 'office_area');

  const overrides: Overrides = { manualPin: null, storeOverrideCodes: new Set() };
  // brain_staff_adjustments(実測アフィニティ)はまだ実データが存在しないため空配列
  // (StaffAdjustmentEngineはstyle_affinity priorへフォールバックする・架空の値を作らない)。
  const adjustments: StaffAdjustment[] = [];

  const evaluator = new JsonLogicEvaluator();
  const orchestrator = new ProposalOrchestrator({
    statsRepo: repos.statsRepo,
    matcher: new PatternMatcher(evaluator),
    scorer: new PatternScorer(),
    resolver: new ConflictResolver(evaluator),
    staffAdjust: new StaffAdjustmentEngine(),
  });

  const proposal = await orchestrator.generateFinalProposalSet({
    ctx, candidates, staff, adjustments, weights, styleAffinity, overrides, recentOutcomes,
    // consentDm: brain_customersにLINE配信同意を表す実データ列が存在しないため、
    // 安全側のfalse固定(同意が確認できない限りDM提案は出さない)。
    consentDm: false,
    nowJst,
  });

  if (!('degraded' in proposal)) {
    const homecareNote = proposal.inStore.mandatory?.proposalKind === 'homecare'
      ? generateHomeCareNote(candidates.find((c) => c.code === proposal.inStore.mandatory?.candidateCode) ?? candidates[0])
      : null;
    if (homecareNote && proposal.inStore.mandatory) {
      proposal.inStore.mandatory.adjustedScript = `${proposal.inStore.mandatory.adjustedScript}\n[${homecareNote}]`;
    }
  }

  const voiceMemoContext = await fetchVoiceMemoContext(input.legacyClient ?? null, customer.name);

  return {
    ok: true,
    proposal,
    context: ctx,
    voiceMemoContext,
    lineHistoryContext: {
      recentCount: lineHistory.length,
      items: lineHistory.map((i) => ({ scenarioCode: i.scenarioCode, approvalStatus: i.approvalStatus, createdAt: i.createdAt })),
    },
  };
}
