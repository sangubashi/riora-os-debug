/**
 * GET /api/admin/proposal-analytics?storeId=...&range=30d|90d|all
 * (AI提案分析MVP、docs/AI_PROPOSAL_ANALYTICS_DASHBOARD_DESIGN.md §4)
 *
 * brain_pattern_fire_log(表示数)・brain_proposal_outcomes(実施率・施術一致率・
 * proposal_kind内訳・月別推移)・brain_pattern_step_stats(パターン別成功率)を
 * 既存データのみで集計して返す(見える化のみ・書込み一切なし)。
 * 既存の/api/admin/proposal-feedback-analytics(👍👎集計)とは独立したエンドポイント。
 *
 * rangeは省略時'30d'(全件取得を避けるため、最も軽い期間をデフォルトにする)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos } from '../../../lib/repos';
import { proposalAnalyticsQuerySchema } from '../../_schemas/query';
import { toValidationErrorResponse } from '../../_schemas/common';
import { aggregateProposalAnalytics } from '@/lib/proposalAnalytics/aggregateProposalAnalytics';
import { requireAdmin } from '@/lib/auth/requireAdmin';

const FETCH_LIMIT = 5000;

function sinceIsoForRange(range: '30d' | '90d' | 'all'): string | null {
  if (range === 'all') return null;
  const days = range === '30d' ? 30 : 90;
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const parsed = proposalAnalyticsQuerySchema.safeParse({
    storeId: req.nextUrl.searchParams.get('storeId'),
    range: req.nextUrl.searchParams.get('range') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(toValidationErrorResponse(parsed.error), { status: 400 });
  }

  try {
    const repos = getRepos();
    const sinceIso = sinceIsoForRange(parsed.data.range);

    const [fireLogEntries, outcomes, stepStats] = await Promise.all([
      repos.briefingRepo.listSinceByStore(parsed.data.storeId, sinceIso, FETCH_LIMIT),
      repos.outcomeRepo.listSinceByStore(parsed.data.storeId, sinceIso, FETCH_LIMIT),
      repos.statsRepo.listAllStepStats(),
    ]);

    const result = aggregateProposalAnalytics({ fireLogEntries, outcomes, stepStats });
    // 取得件数が上限に達した場合、期間内にさらにデータが存在する可能性がある
    // (集計が不完全になり得る)ことを画面側で案内するためのフラグ。
    const truncated = fireLogEntries.length >= FETCH_LIMIT || outcomes.length >= FETCH_LIMIT;

    return NextResponse.json({ success: true, range: parsed.data.range, truncated, ...result });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
