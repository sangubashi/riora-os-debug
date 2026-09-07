-- ================================================================
-- デジタル顧客カルテ Phase 1-A: DB基盤
--
-- 設計根拠: 2026-09-07の3段階READ ONLY調査結果に基づく。
--   - contraindications / brain_customers.goal_note / brain_customer_photos /
--     brain_skin_records は既存構造をそのまま採用し、本migrationでは一切変更しない。
--   - brain_visits には施術記録用の4列のみ追加する(ALTER TABLE、テーブル新設なし)。
--   - 「実購入」(brain_visits.retail_category、CSV取込由来)と「店販提案の結果」を
--     分離するため brain_product_proposals を新設する。
--   - AI/ルールベースの提案候補(booking_prompts等)とは完全に分離した
--     「スタッフが実際に伝えた次回提案」の正式カルテ履歴として brain_staff_proposals を新設する。
--   - 上記2テーブルは、既存のAI提案学習パイプライン
--     (booking_prompts / handover_notes / brain_pattern_fire_log /
--      brain_proposal_outcomes / brain_pattern_progress / brain_staff_adjustments)
--     から一切参照・書き込みされない。CSV import/reconcile処理からも操作しない。
--
-- RLS方針: brain_customer_photos(2026-09-02, PHOTO_KARTE Phase1)で採用された
--   「service_role限定・authenticated/anonへは一切ポリシーを作らない」最終形を踏襲する
--   (karte_importsのような「緩い状態→引き締め」の2段階は踏まない)。
--   書き込み・読み取りは全て、認証(extractStaffFromRequest)・認可(canAccessCustomer)を
--   通過したNext.js APIルート(service roleクライアント使用)経由のみで行う。
--
-- 適用は別途明示的な承認(Phase 1-A実装指示)に基づく。
-- ================================================================

-- ── 1. brain_visits: 施術記録用4列を追加 ──────────────────────────
-- 既存の menu_id / treatment_amount / retail_amount / retail_category 等の意味は変更しない。
-- csvImportPipeline.ts の reconcile()/createSequenced() は toBrainVisitReconcileUpdate() /
-- toBrainVisitInsert() が明示的に列挙する列のみを書き込む設計(mappers.ts、行スプレッドではない)
-- のため、本4列がCSV再取込で上書き・削除されることはない(2026-09-07調査で確認済み)。
ALTER TABLE public.brain_visits
  ADD COLUMN IF NOT EXISTS options           jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS products_used     jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS machine_settings  jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS treatment_memo    text;

COMMENT ON COLUMN public.brain_visits.options IS
  'Phase1-A: 今回施術で選択したオプション名の配列。構造化は将来のUI実装時に確定する(現時点はfree-form JSON)。';
COMMENT ON COLUMN public.brain_visits.products_used IS
  'Phase1-A: 施術中に使用した製品名の配列(店販提案とは別。brain_product_proposalsを参照)。';
COMMENT ON COLUMN public.brain_visits.machine_settings IS
  'Phase1-A: 使用機器・強度設定の自由形式JSON(例: {"device":"...","level":3})。';
COMMENT ON COLUMN public.brain_visits.treatment_memo IS
  'Phase1-A: 施術内容についての一言メモ。customer_notes(会話メモ)とは別の施術記録専用メモ。';

-- ── 2. brain_product_proposals: 店販の「提案→結果」記録 ────────────
-- 実購入(brain_visits.retail_category、CSV会計データ由来)とは明確に分離する。
-- CSV import/reconcile処理からは一切操作しない(このテーブルへの参照は無し)。
CREATE TABLE public.brain_product_proposals (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      uuid        NOT NULL REFERENCES public.brain_stores(id)    ON DELETE CASCADE,
  customer_id   uuid        NOT NULL REFERENCES public.brain_customers(id) ON DELETE CASCADE,
  visit_id      uuid                 REFERENCES public.brain_visits(id)    ON DELETE SET NULL,
  product_name  text        NOT NULL,
  result        text        NOT NULL
                  CHECK (result IN ('purchased', 'considering', 'declined', 'next_time')),
  -- created_by相当。brain_customer_photosと同じくauth.users.idではなくbrain_staff.idを参照する。
  staff_id      uuid                 REFERENCES public.brain_staff(id)     ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.brain_product_proposals IS
  '店販の提案結果ログ(Phase1-A)。1提案=1行の追記専用。brain_visits.retail_category(実購入・CSV由来)とは別概念。CSV import/reconcileからは操作しない。';
COMMENT ON COLUMN public.brain_product_proposals.result IS
  'purchased(購入)/considering(検討中)/declined(見送り)/next_time(次回検討)の4値固定。';

CREATE INDEX IF NOT EXISTS idx_brain_product_proposals_customer
  ON public.brain_product_proposals (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_brain_product_proposals_visit
  ON public.brain_product_proposals (visit_id)
  WHERE visit_id IS NOT NULL;

ALTER TABLE public.brain_product_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bpp_select" ON public.brain_product_proposals
  FOR SELECT TO service_role USING (true);
CREATE POLICY "bpp_insert" ON public.brain_product_proposals
  FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "bpp_update" ON public.brain_product_proposals
  FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "bpp_delete" ON public.brain_product_proposals
  FOR DELETE TO service_role USING (true);
-- authenticated / anon 向けポリシーは意図的に作成しない(default deny)。

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.brain_product_proposals
  TO service_role;

-- ── 3. brain_staff_proposals: スタッフ実提案の正式カルテ履歴 ────────
-- AI/ルールベースの提案候補(booking_prompts.recommended_proposals等)からは
-- 一切自動コピーしない。スタッフが実際に顧客へ伝えた内容のみをここに保存する。
-- 命名: 既存の brain_proposal_outcomes(AI提案の自動学習ログ、CSV由来、proposal_kindが
-- 5種のenum固定で自由文の提案本文を持たない)と意味を混同しないよう、
-- 「スタッフ自身の提案」であることが分かる brain_staff_proposals とする
-- (brain_プレフィックスの既存命名規則は維持しつつ、brain_proposal_outcomesとは
-- 文字面でも明確に区別できることを確認した上で採用)。
CREATE TABLE public.brain_staff_proposals (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       uuid        NOT NULL REFERENCES public.brain_stores(id)    ON DELETE CASCADE,
  customer_id    uuid        NOT NULL REFERENCES public.brain_customers(id) ON DELETE CASCADE,
  visit_id       uuid                 REFERENCES public.brain_visits(id)    ON DELETE SET NULL,
  staff_id       uuid                 REFERENCES public.brain_staff(id)     ON DELETE SET NULL,
  proposal_text  text        NOT NULL,
  status         text        NOT NULL DEFAULT 'proposed'
                   CHECK (status IN ('proposed', 'executed', 'declined', 'changed', 'unknown')),
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.brain_staff_proposals IS
  'スタッフが実際に顧客へ伝えた次回提案の正式カルテ履歴(Phase1-A)。AI/ルールベースの提案候補(booking_prompts等)や brain_proposal_outcomes(AI提案の自動学習ログ)からは自動コピーしない。';
COMMENT ON COLUMN public.brain_staff_proposals.status IS
  'proposed(提案済み)/executed(実施済み)/declined(見送り)/changed(内容変更)/unknown(未確認)の5値固定。';

CREATE INDEX IF NOT EXISTS idx_brain_staff_proposals_customer
  ON public.brain_staff_proposals (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_brain_staff_proposals_visit
  ON public.brain_staff_proposals (visit_id)
  WHERE visit_id IS NOT NULL;

ALTER TABLE public.brain_staff_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bsp_select" ON public.brain_staff_proposals
  FOR SELECT TO service_role USING (true);
CREATE POLICY "bsp_insert" ON public.brain_staff_proposals
  FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "bsp_update" ON public.brain_staff_proposals
  FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "bsp_delete" ON public.brain_staff_proposals
  FOR DELETE TO service_role USING (true);
-- authenticated / anon 向けポリシーは意図的に作成しない(default deny)。

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.brain_staff_proposals
  TO service_role;
