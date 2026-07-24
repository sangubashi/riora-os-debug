/**
 * GET /api/blog-articles/related?products=A&products=B (BLOG_CONTENT_PHASE2)
 *
 * 顧客詳細シート「🏠 ホームケア使用商品」の「関連記事」表示専用API。
 * 認証は一般スタッフでよい(requireAdminではない。顧客詳細は通常のスタッフ全員が
 * 開く画面のため)。brain_blog_articlesはPII・顧客個人情報を含まないため、
 * canAccessCustomer相当の顧客アクセス制御は不要(商品名だけで検索する)。
 *
 * 取得条件: is_customer_safe=true かつ status='approved' の記事のみ、
 * 渡された商品名のいずれかとproductsが重複するもの、最大3件。
 * 記事本文・外部URLは返さない(タイトルのみ。外部URL遷移禁止のため)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos } from '../../../lib/repos';
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest';

const MAX_RESULTS = 3;

export async function GET(req: NextRequest) {
  const staff = await extractStaffFromRequest(req);
  if (!staff) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 });
  }

  const products = req.nextUrl.searchParams.getAll('products').map(p => p.trim()).filter(Boolean);

  let repos;
  try {
    repos = getRepos();
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }

  try {
    const articles = await repos.blogArticleRepo.listApprovedByProducts(products, MAX_RESULTS);
    // 顧客向け表示専用: タイトルのみ返す(本文・URLは意図的に含めない)。
    const items = articles.map(a => ({ id: a.id, title: a.title }));
    return NextResponse.json({ success: true, articles: items });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
