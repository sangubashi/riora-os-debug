/**
 * GET /api/briefing?customerId=... (GetBriefing, P0簡易版)
 *
 * brain_pattern_fire_logの直近1件(+顧客名)をBriefingEntryとして返す。
 *
 * 未実装: patternLabel/todayGoal/talkHint等を含む完全なBriefing型は
 * pattern_library結合とEngine層の文言生成を要するため、本Stepでは
 * decision_record(DecisionRecord)とexplanationをそのまま返す。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos } from '../../lib/repos';
import { customerIdQuerySchema } from '../_schemas/query';
import { toValidationErrorResponse } from '../_schemas/common';

export async function GET(req: NextRequest) {
  const parsed = customerIdQuerySchema.safeParse({
    customerId: req.nextUrl.searchParams.get('customerId'),
  });
  if (!parsed.success) {
    return NextResponse.json(toValidationErrorResponse(parsed.error), { status: 400 });
  }

  let repos;
  try {
    repos = getRepos();
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }

  try {
    const briefing = await repos.briefingRepo.latestByCustomer(parsed.data.customerId);
    if (!briefing) {
      return NextResponse.json({ success: false, error: 'briefing_not_found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, briefing });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
