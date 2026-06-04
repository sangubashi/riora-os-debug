-- ================================================================
-- Riora OS: 不足テーブル補完 Migration
-- 実行: Supabase Dashboard > SQL Editor に貼り付けて Run
--
-- 対象:
--   1. customer_notes      -- 接客メモ
--   2. customers_secure    -- 顧客機密データ（AI分析・hash_id管理）
--   3. voice-notes         -- Storage bucket（音声メモ）
--
-- 設計思想:
--   - CREATE TABLE IF NOT EXISTS で冪等（何度実行しても安全）
--   - 必要最低限カラムのみ（nullable 最小構成）
--   - RLS 有効化（authenticated ユーザーのみ参照可）
--   - テーブルが存在しなくてもアプリが止まらない設計に対応
-- ================================================================


-- ----------------------------------------------------------------
-- 1. customer_notes
--    用途: CustomerBottomSheet の接客メモ（select/insert）
--    参照カラム: id, customer_id, staff_id, note, created_at
-- ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.customer_notes (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  uuid        NOT NULL
                             REFERENCES public.customers(id)
                             ON DELETE CASCADE,
  staff_id     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  note         text        NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- 顧客別・時系列取得用
CREATE INDEX IF NOT EXISTS idx_customer_notes_customer_created
  ON public.customer_notes (customer_id, created_at DESC);

-- RLS
ALTER TABLE public.customer_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cn_select" ON public.customer_notes;
DROP POLICY IF EXISTS "cn_insert" ON public.customer_notes;
DROP POLICY IF EXISTS "cn_update" ON public.customer_notes;

-- 全認証ユーザーが参照可（単一サロン設計）
CREATE POLICY "cn_select" ON public.customer_notes
  FOR SELECT USING (auth.role() = 'authenticated');

-- 認証ユーザーが自分の書き込み可
CREATE POLICY "cn_insert" ON public.customer_notes
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- 自分が書いたメモのみ更新可
CREATE POLICY "cn_update" ON public.customer_notes
  FOR UPDATE USING (staff_id = auth.uid());


-- ----------------------------------------------------------------
-- 2. customers_secure
--    用途: AI分析エンジン・予約画面・管理ダッシュボードの顧客機密データ
--    参照カラム:
--      appointments.ts  : hash_id, visit_count, customer_type,
--                         is_vip, last_visit_at, notes, risk_score
--      customerManager  : hash_id, birthday, skin_type, ltv,
--                         visit_count, customer_type, is_vip,
--                         last_visit_at, notes, risk_score
--      analysisEngine   : hash_id, risk_score, customer_type, notes
--      adminDashboard   : hash_id, birthday, skin_type, risk_score,
--                         ltv, visit_count, customer_type, is_vip,
--                         last_visit_at, notes
--    PK: hash_id（UUID ではなく識別子文字列）
-- ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.customers_secure (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hash_id         text        NOT NULL UNIQUE,          -- 外部連携用（PII なし識別子）
  customer_id     uuid        REFERENCES public.customers(id) ON DELETE SET NULL,

  -- 基本属性
  birthday        date,                                 -- YYYY-MM-DD
  skin_type       text        CHECK (
                    skin_type IS NULL OR
                    skin_type IN ('dry','oily','combination','sensitive','normal')
                  ),
  customer_type   text,                                 -- 'sincere'|'speed'|'luxury'|接客タイプ
  is_vip          boolean     NOT NULL DEFAULT false,

  -- 集計値（AI分析エンジンが更新）
  risk_score      integer     NOT NULL DEFAULT 0
                              CHECK (risk_score BETWEEN 0 AND 100),
  visit_count     integer     NOT NULL DEFAULT 0,
  ltv             numeric(12,2) NOT NULL DEFAULT 0,     -- 累計売上
  last_visit_at   timestamptz,

  -- メモ
  notes           text,

  -- タイムスタンプ
  last_analysis_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- hash_id 検索用
CREATE INDEX IF NOT EXISTS idx_customers_secure_hash_id
  ON public.customers_secure (hash_id);

CREATE INDEX IF NOT EXISTS idx_customers_secure_customer_id
  ON public.customers_secure (customer_id);

-- updated_at 自動更新
CREATE OR REPLACE FUNCTION _set_updated_at_customers_secure()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customers_secure_updated_at
  ON public.customers_secure;

CREATE TRIGGER trg_customers_secure_updated_at
  BEFORE UPDATE ON public.customers_secure
  FOR EACH ROW EXECUTE FUNCTION _set_updated_at_customers_secure();

-- RLS
ALTER TABLE public.customers_secure ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cs_select" ON public.customers_secure;
DROP POLICY IF EXISTS "cs_insert" ON public.customers_secure;
DROP POLICY IF EXISTS "cs_update" ON public.customers_secure;
DROP POLICY IF EXISTS "cs_upsert" ON public.customers_secure;

-- owner / admin は全操作可、staff は参照のみ
CREATE POLICY "cs_select" ON public.customers_secure
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "cs_insert" ON public.customers_secure
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('owner','admin')
    )
  );

CREATE POLICY "cs_update" ON public.customers_secure
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('owner','admin')
    )
  );


-- ----------------------------------------------------------------
-- 3. voice-notes Storage bucket
--    用途: 音声メモファイルの保存
--    パス: voice-notes/{staffId}/{customerId}/{timestamp}.webm
--    操作: upload / createSignedUrl / remove
-- ----------------------------------------------------------------

-- bucket 作成（既存なら skip）
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'voice-notes',
  'voice-notes',
  false,           -- private bucket（signed URL でのみアクセス）
  52428800,        -- 50MB / ファイル
  ARRAY[
    'audio/webm',
    'audio/mp4',
    'audio/mpeg',
    'audio/ogg',
    'audio/wav',
    'audio/m4a',
    'audio/x-m4a'  -- iPhone Safari が生成する形式
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS（既存ポリシーを安全に再作成）
DROP POLICY IF EXISTS "voice_notes_upload"  ON storage.objects;
DROP POLICY IF EXISTS "voice_notes_select"  ON storage.objects;
DROP POLICY IF EXISTS "voice_notes_delete"  ON storage.objects;

-- 認証ユーザーのみアップロード可
CREATE POLICY "voice_notes_upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'voice-notes'
    AND auth.role() = 'authenticated'
  );

-- 認証ユーザーは全ファイル参照可（signed URL 生成のため）
CREATE POLICY "voice_notes_select" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'voice-notes'
    AND auth.role() = 'authenticated'
  );

-- 認証ユーザーは全ファイル削除可（スタッフが自分のメモを削除）
CREATE POLICY "voice_notes_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'voice-notes'
    AND auth.role() = 'authenticated'
  );


-- ================================================================
-- 実行確認クエリ
-- ================================================================
-- SELECT table_name
-- FROM information_schema.tables
-- WHERE table_schema = 'public'
--   AND table_name IN ('customer_notes','customers_secure')
-- ORDER BY table_name;
--
-- SELECT id, name, public, file_size_limit
-- FROM storage.buckets
-- WHERE id = 'voice-notes';
-- ================================================================
