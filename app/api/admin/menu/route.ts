/**
 * GET /api/admin/menu?storeId=... (メニュー画面)
 *
 * brain_menus/brain_visitsをその場で集計し、メニュー一覧(価格/役割/対象タイプ/
 * 今月の件数・売上/次回予約率)とサマリーを返す(MenuAnalyticsEngine・決定論ルール・
 * LLM不使用)。実データソースが存在しない指標(リピート率/利益率/AI推奨率/
 * アップセル成功率/VIP移行率)はnull固定で返す(UI側で「未実装」等を表示する)。
 *
 * 閲覧専用API(GETのみ)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos } from '../../../lib/repos';
import { storeIdQuerySchema } from '../../_schemas/query';
import { toValidationErrorResponse } from '../../_schemas/common';
import { computeMenuAnalytics } from '@/lib/menu/MenuAnalyticsEngine';

export async function GET(req: NextRequest) {
  const parsed = storeIdQuerySchema.safeParse({
    storeId: req.nextUrl.searchParams.get('storeId'),
  });
  if (!parsed.success) {
    return NextResponse.json(toValidationErrorResponse(parsed.error), { status: 400 });
  }

  const { storeId } = parsed.data;

  let repos;
  try {
    repos = getRepos();
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }

  try {
    const [menus, visits] = await Promise.all([
      repos.menuRepo.listByStore(storeId),
      repos.visitRepo.listByStore(storeId),
    ]);

    const { menus: menuRows, summary } = computeMenuAnalytics({ menus, visits });

    return NextResponse.json({ success: true, storeId, menus: menuRows, summary });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
