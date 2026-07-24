/**
 * GET /api/blog-articles/knowledge-match?keywords=A&keywords=B&categories=C (PHASE2-C-2/C-3)
 *
 * 顧客の肌タグ・AIタグから導出した候補語(keywords)、ホームケア購入商品から導出した
 * 商品カテゴリ候補(categories)のうち、is_customer_safe=trueかつstatus='approved'の
 * 記事と1件以上一致したものだけをそれぞれ返す。
 * 記事のid・title・summary・source_urlは一切返さない
 * (返すのは呼び出し側が渡した候補語のサブセットのみ。KNOWLEDGE_AI_INTEGRATION_AUDIT_1
 * 6章の「summaryを画面表示経路に直接乗せない」防御方針を踏襲し、/relatedより厳格にする)。
 *
 * 呼び出し元(想定):
 *   - generateNextActions.ts（AI提案の生成理由(reasons)補強用）
 *   - CustomerBottomSheet.tsx（接客ヒント・生成理由の表示用）
 * いずれも実際に画面へ出す文言は固定テンプレート・タグ名/カテゴリ名そのもの
 * (src/lib/nextAction/knowledgeMatch.ts)であり、記事本文・summaryを画面表示に使うことはない。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRepos } from '../../../lib/repos';
import { extractStaffFromRequest } from '@/lib/auth/extractStaffFromRequest';

const MAX_ARTICLES = 5;

function uniqueTrimmed(values: string[]): string[] {
  return Array.from(new Set(values.map(v => v.trim()).filter(Boolean)));
}

export async function GET(req: NextRequest) {
  const staff = await extractStaffFromRequest(req);
  if (!staff) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 });
  }

  const keywordVocabulary  = uniqueTrimmed(req.nextUrl.searchParams.getAll('keywords'));
  const categoryVocabulary = uniqueTrimmed(req.nextUrl.searchParams.getAll('categories'));

  if (keywordVocabulary.length === 0 && categoryVocabulary.length === 0) {
    return NextResponse.json({ success: true, matchedKeywords: [], matchedCategories: [] });
  }

  let repos;
  try {
    repos = getRepos();
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }

  try {
    const [keywordArticles, categoryArticles] = await Promise.all([
      repos.blogArticleRepo.listApprovedByKeywords(keywordVocabulary, MAX_ARTICLES),
      repos.blogArticleRepo.listApprovedByCategories(categoryVocabulary, MAX_ARTICLES),
    ]);

    const articleKeywords  = new Set(keywordArticles.flatMap(a => a.keywords));
    const articleCategories = new Set(categoryArticles.map(a => a.category).filter((c): c is string => Boolean(c)));

    const matchedKeywords   = keywordVocabulary.filter(k => articleKeywords.has(k));
    const matchedCategories = categoryVocabulary.filter(c => articleCategories.has(c));

    return NextResponse.json({ success: true, matchedKeywords, matchedCategories });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
