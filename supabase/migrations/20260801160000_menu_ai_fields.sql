-- ================================================================
-- 2026-08-01: PHASE MENU-AI-1 — メニューにAI提案向け詳細情報を追加
--
-- 背景: 管理者メニュー画面(brain_menus)にはname/price/role/target_typesしか
-- 無く、Riora OS内のAI系機能(AI提案・LINE AI・ホームケア提案等)がメニュー内容を
-- 理解して提案する手掛かりが存在しなかった。既存テーブルを拡張し、AIへ渡す
-- 情報(ai_tags等)を短いタグ/数値のみで保持できるようにする
-- (長文説明はAIへ渡さない方針のため、そもそも長文用の列は追加しない)。
--
-- 新規テーブルは作らず、既存brain_menusへのADD COLUMNのみ(加算のみ・
-- 既存データへの破壊的変更なし)。全列NULL許容またはDEFAULT '{}'のため、
-- 本migration適用のみでは既存の挙動(表示・API・AI提案)は一切変わらない。
-- 値の入力は別途(管理者による手動登録 or 将来のUI実装)で行う。
-- ================================================================

ALTER TABLE public.brain_menus
  ADD COLUMN IF NOT EXISTS duration_minutes integer,
  ADD COLUMN IF NOT EXISTS skin_concern_tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS expected_effects text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS recommended_cycle_days integer,
  ADD COLUMN IF NOT EXISTS contraindication_tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS recommended_homecare_products text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ai_tags text[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'brain_menus_duration_minutes_check'
  ) THEN
    ALTER TABLE public.brain_menus
      ADD CONSTRAINT brain_menus_duration_minutes_check
        CHECK (duration_minutes IS NULL OR duration_minutes >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'brain_menus_recommended_cycle_days_check'
  ) THEN
    ALTER TABLE public.brain_menus
      ADD CONSTRAINT brain_menus_recommended_cycle_days_check
        CHECK (recommended_cycle_days IS NULL OR recommended_cycle_days >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.brain_menus.duration_minutes IS
  '施術時間(分)。未入力はNULL。';
COMMENT ON COLUMN public.brain_menus.skin_concern_tags IS
  '対象肌悩みタグ(例: 乾燥・ニキビ・毛穴・たるみ)。brain_customers.customer_type'
  '(性格・接客傾向の型)とは別軸で、肌の悩みそのものを表す短いタグの配列。';
COMMENT ON COLUMN public.brain_menus.expected_effects IS
  '期待できる効果タグ(例: 保湿・美白・リフトアップ)。管理画面での表示・確認用。'
  'PHASE MENU-AI-1時点ではAIプロンプトの許可リストに含めない'
  '(buildMenuAIContext()参照。ai_tagsで代替する)。';
COMMENT ON COLUMN public.brain_menus.recommended_cycle_days IS
  'このメニューのおすすめ来店サイクル(日数)。brain_customers.recommended_cycle_days'
  '(顧客個別の上書き値)と同じ命名・単位。顧客側が未設定の場合のメニュー起点の'
  'デフォルト値として使う想定(現時点では自動連携なし・取得可能な状態のみ)。';
COMMENT ON COLUMN public.brain_menus.contraindication_tags IS
  'このメニュー共通の禁忌タグ(例: 妊娠中・強い日焼け直後)。顧客個別のcontraindications'
  'テーブル(顧客ごとの禁忌)とは別軸で、メニュー自体が持つ一般的な禁忌の短いタグ。';
COMMENT ON COLUMN public.brain_menus.recommended_homecare_products IS
  'このメニューにおすすめのホームケア商品名タグ。管理画面での表示・確認用。'
  'PHASE MENU-AI-1時点ではAIプロンプトの許可リストに含めない(buildMenuAIContext()参照)。';
COMMENT ON COLUMN public.brain_menus.ai_tags IS
  'AI提案(NextAction・LINE AI・ホームケア提案等)向けの短いタグ配列'
  '(例: 乾燥・ニキビ・毛穴・たるみ・くすみ・敏感肌・リフトアップ・保湿・美白・赤み)。'
  'メニュー説明の長文はAIへ渡さない方針のため、この列のタグのみをAIコンテキストに含める'
  '(buildMenuAIContext()参照)。';
