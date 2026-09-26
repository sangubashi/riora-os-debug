-- ================================================================
-- 写真カルテ サムネイル機能③: brain_customer_photos に
-- thumbnail_storage_path 列を追加
-- 設計根拠: 2026-09-26ユーザー承認(READ ONLY設計監査を経て確定)。
--
-- 原本(storage_path)は一切変更しない。表示用の軽量サムネイル(長辺400px・
-- WebP quality 0.78)を原本とは別のStorageオブジェクトとして保存し、そのパスを
-- 本列に記録する。原本とサムネイルはclientRequestId起点で1対1対応する
-- ({storeId}/{customerId}/{clientRequestId}.{ext} と
--  {storeId}/{customerId}/{clientRequestId}_thumb.{ext})。
--
-- nullableとする理由: 既存データ(本ファイル作成時点で71件程度)は当然サムネイルを
-- 持たない。またサムネイルのStorageアップロード自体が失敗しても原本の保存は
-- 成功として扱う設計のため、失敗時もNULLのまま許容する必要がある。
-- NULLの場合はsignedUrl.ts側で storage_path(原本) へフォールバックするため、
-- 既存データ・生成失敗データとも表示は壊れない。
--
-- index追加は不要: 本列はidで行を引いた後に読むだけで、本列自体をWHERE句の
-- 絞り込み条件に使う予定は無いため。
--
-- 既存71件のバックフィルは本migrationのスコープ外(別途判断・別作業とする)。
--
-- 適用は別途明示的な承認があるまで行わない(本ファイルはレビュー用に作成のみ)。
-- ================================================================

ALTER TABLE public.brain_customer_photos
  ADD COLUMN IF NOT EXISTS thumbnail_storage_path text;

COMMENT ON COLUMN public.brain_customer_photos.thumbnail_storage_path IS
  '一覧・グリッド表示用の軽量サムネイル(長辺400px・WebP quality 0.78目安)のStorageパス。
   storage_path(原本)とはclientRequestId起点で1対1対応し、原本にのみ_thumbサフィックスを
   付けたパスになる。NULL=未生成(既存データ、または生成/アップロード失敗により原本へ
   フォールバックする状態)。原本(storage_path)は本列の追加・値の有無に一切影響されない。';

-- ================================================================
-- 適用後確認用SELECT(実行結果を目視確認してください)
-- ================================================================
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'brain_customer_photos'
ORDER BY ordinal_position;
