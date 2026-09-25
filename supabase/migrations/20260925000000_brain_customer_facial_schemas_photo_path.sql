-- ================================================================
-- 顔シェーマ機能: brain_customer_facial_schemas に photo_path 列を追加
-- 設計根拠: 2026-09-25ユーザー承認(過去の来店/移行データの顔シェーマを、
--   その場で描き直す代わりに、サロンボード等の紙カルテを撮影・アップロードした
--   写真として記録できるようにする)。
--
-- 既存のstrokes_data(ベクター描画)列とは独立したnullable列として追加するのみ。
-- 既存の描画機能(FacialSchemaSection.tsx・PUT /api/customers/[id]/facial-schemas)
-- には一切影響しない(photo_pathを一切参照しない既存コードは無変更で動作する)。
--
-- 適用は別途明示的な承認があるまで行わない(本ファイルはレビュー用に作成のみ)。
-- ================================================================

ALTER TABLE public.brain_customer_facial_schemas
  ADD COLUMN IF NOT EXISTS photo_path text;

COMMENT ON COLUMN public.brain_customer_facial_schemas.photo_path IS
  '過去来店/移行データ用: サロンボード等の紙カルテを撮影・アップロードした画像のStorageパス(customer-photos bucket)。strokes_data(ベクター描画)とは独立・併存可能。NULL=写真アップロードなし(ベクター描画のみ、または未記録)。';

-- ================================================================
-- 適用後確認用SELECT(実行結果を目視確認してください)
-- ================================================================
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'brain_customer_facial_schemas'
ORDER BY ordinal_position;
