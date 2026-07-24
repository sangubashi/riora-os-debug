-- ================================================================
-- KNOWLEDGE_IMPORT_PHASE1_IMPLEMENT_1 (2026-07-17)
--
-- 目的: CSV取込によるナレッジ管理画面(/admin/knowledge-import)向けに、
-- brain_blog_articles へ category / summary 列を追加する。
-- 設計根拠: docs/KNOWLEDGE_IMPORT_PHASE1_AUDIT_1.md
--
-- 重要な制約(実装方針に直結):
--   - LLM・外部API連携は一切行わない。CSVの内容をそのまま保存するだけ。
--   - brain_care_knowledge テーブルは本フェーズでは作成しない
--     (KNOWLEDGE_IMPORT_PHASE1_AUDIT_1・今回の指示で「実装しない」と明記された範囲)。
--   - 既存のBLOG_CONTENT_PHASE1/PHASE2機能(/admin/blog-content、
--     /api/admin/blog-articles、CustomerBottomSheetの関連記事表示、AI提案)は
--     一切変更しない。本migrationは列追加のみ・両列ともnullableでデフォルト値を
--     持たないため、既存の行・既存機能の挙動に影響しない。
--
-- 本番適用: このセッションでは行っていない。適用にはユーザー側での実行が別途必要。
-- ================================================================

ALTER TABLE public.brain_blog_articles
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS summary  text;

COMMENT ON COLUMN public.brain_blog_articles.category IS
  'CSV取込(KNOWLEDGE_IMPORT_PHASE1・/admin/knowledge-import)のcategory列。LLM等による加工は行わずCSVの内容をそのまま保存する。';
COMMENT ON COLUMN public.brain_blog_articles.summary IS
  'CSV取込(KNOWLEDGE_IMPORT_PHASE1・/admin/knowledge-import)のsummary列。管理者が自分で書いた要約を想定(スクレイピングではない)。LLM要約・タグ抽出等の加工は一切行わない。';
