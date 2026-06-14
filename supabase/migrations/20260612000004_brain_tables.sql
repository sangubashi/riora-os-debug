-- ================================================================
-- Riora Brain Phase1 - Step1: ブランド横断 (brain_*) テーブル
--
-- これらのテーブルは元々 brain_ プレフィックスを持つ全店舗共有データで、
-- 既存スキーマとの命名衝突は無い。nightly-etl で匿名化されたイベントを
-- 蓄積し、monthly-learning(Phase3) や brain_pattern_library 配信に使う。
-- ================================================================

-- ---------------------------------------------------------------
-- brain_events (仕様書2-8)
-- nightly-etlが書き込む匿名化イベントログ。
-- 冪等キー: (store_anon_id, customer_hash, event_type, occurred_on, visit_count_at)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.brain_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_anon_id   uuid        NOT NULL,
  customer_hash   text        NOT NULL,
  event_type      text        NOT NULL,
  customer_type   text        CHECK (customer_type IN ('A_acne', 'B_pore', 'C_sensitive', 'D_aging', 'E_bridal')),
  staff_style     text        CHECK (staff_style IN ('evidence', 'theory', 'empathy')),
  proposal_kind   text        CHECK (proposal_kind IN ('homecare', 'rebooking', 'subscription', 'upsell', 'pack', 'none')),
  was_accepted    boolean,
  occurred_on     date        NOT NULL,
  visit_count_at  integer     NOT NULL,
  amount_band     text,
  payload         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_anon_id, customer_hash, event_type, occurred_on, visit_count_at)
);

CREATE INDEX IF NOT EXISTS idx_brain_events_cluster ON public.brain_events (event_type, customer_type);

COMMENT ON TABLE public.brain_events IS
  'nightly-etlによる匿名化イベント。customer_hash = sha256(customer_id + store.anon_salt)。実名・実金額・時刻・スタッフ名は含めない。';
COMMENT ON COLUMN public.brain_events.customer_hash IS
  'sha256(customer_id + store.anon_salt) の16進文字列。';
COMMENT ON COLUMN public.brain_events.amount_band IS
  '金額を帯域化した文字列(例: "10000-15000")。実金額は保持しない。';
COMMENT ON COLUMN public.brain_events.payload IS
  '追加の匿名化済み属性 (例: wedding_days_band, skin_improved 等)。実名/PIIを含めないこと。';

-- ---------------------------------------------------------------
-- brain_pattern_library (仕様書2-9)
-- ブランド横断で共有される成功パターン候補/承認済みパターン。
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.brain_pattern_library (
  id                text        PRIMARY KEY,
  customer_type     text        NOT NULL CHECK (customer_type IN ('A_acne', 'B_pore', 'C_sensitive', 'D_aging', 'E_bridal')),
  label             text        NOT NULL,
  entry_condition   jsonb       NOT NULL,
  steps             jsonb       NOT NULL,
  target_cycle_days integer     NOT NULL CHECK (target_cycle_days > 0),
  status            text        NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'rejected')),
  version           integer     NOT NULL DEFAULT 1,
  sample_stores     integer     NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brain_pattern_library_status ON public.brain_pattern_library (status, customer_type);

COMMENT ON COLUMN public.brain_pattern_library.steps IS
  'brain_pattern_steps相当のstep配列(label/proposal_kind/menu_role/fire_condition/base_script/cooldown_visits)をJSONBで保持。';
COMMENT ON COLUMN public.brain_pattern_library.status IS
  'approvedのみ各店舗から brain_install としてSELECT/導入可能。';

-- ---------------------------------------------------------------
-- brain_benchmarks
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.brain_benchmarks (
  week           date        NOT NULL,
  store_cluster  text        NOT NULL,
  metric         text        NOT NULL,
  customer_type  text        NOT NULL CHECK (customer_type IN ('A_acne', 'B_pore', 'C_sensitive', 'D_aging', 'E_bridal')),
  p25            numeric,
  p50            numeric,
  p75            numeric,
  sample_stores  integer     NOT NULL DEFAULT 0,
  is_reference   boolean     NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (week, store_cluster, metric, customer_type)
);

COMMENT ON COLUMN public.brain_benchmarks.is_reference IS
  'sample_stores < 5 の場合true。1店舗集中による偏りの可能性を示すフラグ。';

-- ---------------------------------------------------------------
-- brain_params
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.brain_params (
  key         text        NOT NULL,
  cluster     text        NOT NULL,
  version     integer     NOT NULL,
  value       jsonb       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key, cluster, version)
);

COMMENT ON TABLE public.brain_params IS
  'src/engines/constants.ts の閾値・重みをクラスタ単位で上書きするためのパラメータストア。Phase1では参照のみ。';

-- ---------------------------------------------------------------
-- brain_revisions (ブランド横断 brain_pattern_library の改訂提案)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.brain_revisions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_library_id  text        NOT NULL REFERENCES public.brain_pattern_library(id) ON DELETE CASCADE,
  change_type         text        NOT NULL CHECK (change_type IN ('timing', 'condition', 'script', 'new_pattern', 'churn_weights', 'staff_adjustment')),
  before              jsonb       NOT NULL,
  after               jsonb       NOT NULL,
  evidence            jsonb       NOT NULL,
  status              text        NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'rejected', 'auto_applied')),
  decided_by          uuid,
  decided_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.brain_revisions IS
  'ブランド横断パターンの改訂提案。Lv4ガード(原則抵触チェック)はDB制約ではなくsrc/engines/pattern/Lv4Validator.tsのvalidateRevision()で起票前に実施する。';
