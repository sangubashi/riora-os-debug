-- ================================================================
-- BLOG_CONTENT_PHASE1_IMPLEMENT_1 (2026-07-17)
--
-- 目的: サロンブログ記事をRioraへ取り込む基盤(Phase1-A/Phase1-Bのみ)。
-- 設計根拠: docs/BLOG_CONTENT_PHASE1_AUDIT.md
--
-- 重要な制約(実装方針に直結):
--   - 記事本文・要約は保存しない(スクレイピング禁止・URL登録のみ)。
--     このためbody/summary/category等の列は意図的に持たせていない。
--   - 薬機法チェックロジック・AI生成・推測は一切実装しない。
--     is_customer_safeは管理者が手動でON/OFFする単純なbooleanフラグ。
--   - store_id列は持たない(依頼のDDL通り。現状単一店舗運用のアプリ全体の
--     方針とも整合するが、複数店舗化時は追加検討が必要)。
--
-- 本番適用: このセッションでは行っていない(本番DB更新禁止の指示のため)。
-- 適用にはユーザー側での実行が別途必要。
-- ================================================================

CREATE TABLE IF NOT EXISTS public.brain_blog_articles (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title             text        NOT NULL,
  source_url        text        NOT NULL,
  products          text[]      NOT NULL DEFAULT '{}',
  keywords          text[]      NOT NULL DEFAULT '{}',
  is_customer_safe  boolean     NOT NULL DEFAULT false,
  status            text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
  published_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blog_articles_products ON public.brain_blog_articles USING gin (products);
CREATE INDEX IF NOT EXISTS idx_blog_articles_keywords ON public.brain_blog_articles USING gin (keywords);

COMMENT ON TABLE public.brain_blog_articles IS
  'サロンブログ記事の取込基盤(BLOG_CONTENT_PHASE1)。記事本文は保存しない(URL登録のみ)。is_customer_safeは管理者が手動でON/OFFする承認フラグで、自動判定ロジックは持たない。Phase2(顧客表示・CustomerBottomSheet接続)・Phase3(AI提案連携)は本テーブル作成時点では未接続。';
COMMENT ON COLUMN public.brain_blog_articles.source_url IS
  '記事の参照元URL。本文取得・スクレイピングは行わない(URL登録のみの方針)。';
COMMENT ON COLUMN public.brain_blog_articles.is_customer_safe IS
  '顧客向け表示の可否フラグ。管理画面の「承認切替」ボタンで手動ON/OFFする。薬機法チェックの自動化・AI判定は一切行わない。';
COMMENT ON COLUMN public.brain_blog_articles.status IS
  '編集ワークフロー状態(draft|approved)。is_customer_safeの切替と連動して更新する(BlogArticleRepo.update()参照)。';

-- RLS: 本プロジェクトのbrain_*テーブルと同様、アプリはservice_roleクライアント
-- (app/lib/repos.ts getClient())経由でのみアクセスする方針のため、他のbrain_*
-- テーブルと整合させてRLSは有効化しない。
