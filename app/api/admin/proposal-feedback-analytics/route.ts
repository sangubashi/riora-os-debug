/**
 * GET /api/admin/proposal-feedback-analytics?storeId=...&range=30d|90d|all
 * (AI提案学習Phase2・管理者分析、Phase2.5で期間フィルタを追加)
 *
 * brain_pattern_fire_log.decision_record.staffFeedback(👍👎)をstore単位で読み出し、
 * 提案種類別・パターン別に集計して返すだけ(見える化のみ)。
 * PatternScorer/ProposalEngineへは接続しない。DB書込・スキーマ変更は一切行わない。
 *
 * rangeは省略時'30d'(全件取得を避けるため、最も軽い期間をデフォルトにする)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos } from '../../../lib/repos';
import { proposalFeedbackAnalyticsQuerySchema } from '../../_schemas/query';
import { toValidationErrorResponse } from '../../_schemas/common';
import { aggregateProposalFeedback } from '@/lib/proposalFeedback/aggregateProposalFeedback';
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

  const parsed = proposalFeedbackAnalyticsQuerySchema.safeParse({
    storeId: req.nextUrl.searchParams.get('storeId'),
    range: req.nextUrl.searchParams.get('range') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(toValidationErrorResponse(parsed.error), { status: 400 });
  }

  try {
    const repos = getRepos();
    const sinceIso = sinceIsoForRange(parsed.data.range);
    const rows = await repos.briefingRepo.listWithStaffFeedback(parsed.data.storeId, {
      sinceIso,
      limit: FETCH_LIMIT,
    });
    const summary = aggregateProposalFeedback(rows);
    // 取得件数が上限に達した場合、期間内にさらにデータが存在する可能性がある
    // (集計が不完全になり得る)ことを画面側で案内するためのフラグ。
    const truncated = rows.length >= FETCH_LIMIT;

    return NextResponse.json({ success: true, range: parsed.data.range, truncated, ...summary });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
