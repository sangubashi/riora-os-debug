-- ================================================================
-- Phase 0: brain_* Master Schema 本番構築バンドル
--
-- 本ファイルは supabase/migrations/20260612000001〜000009 (9ファイル) を
-- 実行順にそのまま連結したものです。各ファイルの内容は一切変更していません
-- (コピー&ペースト用の確認・適用バンドルであり、これ自体は正式なマイグレー
-- ション管理対象ではありません。適用後は削除してください)。
--
-- 適用方法: Supabase Dashboard > SQL Editor に全文を貼り付けて実行してください。
-- 全ステートメントが IF NOT EXISTS / ON CONFLICT DO NOTHING で冪等なため、
-- 途中で失敗して再実行しても安全です。
-- ================================================================


-- ################################################################
-- # 20260612000001_core_tables.sql
-- ################################################################

-- ================================================================
-- Riora Brain Phase1 - Step1: コアテーブル
--
-- 命名規則: 既存スキーマ (customers / visits / staff / bookings / menus /
-- subscriptions など) との衝突を避けるため、Riora Brain が新規に持つ
-- テーブルは全て brain_ プレフィックスを付与し public スキーマに置く。
-- TypeScript側の型名 (Customer, Visit 等) は riora.types.ts で定義する
-- ドメイン名をそのまま使用し、DBテーブル名のみ brain_ を付与する。
-- ================================================================

-- ---------------------------------------------------------------
-- brain_stores
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.brain_stores (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text        NOT NULL,
  anon_id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  -- pgcrypto (gen_random_bytes) は環境によって使用できないため、
  -- gen_random_uuid() のハイフン除去 (32桁hex = 128bit) で代替する。
  anon_salt           text        NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
  cluster             text,
  price_tier          text,
  brain_subscription  boolean     NOT NULL DEFAULT false,
  learning_mode       boolean     NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_brain_stores_anon_id ON public.brain_stores (anon_id);

COMMENT ON TABLE public.brain_stores IS
  'Riora Brain Phase1: 店舗マスタ。anon_id/anon_salt はnightly-etlでのbrain_events匿名化に使用。';

-- ---------------------------------------------------------------
-- brain_staff
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.brain_staff (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid        NOT NULL REFERENCES public.brain_stores(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  style       text        NOT NULL CHECK (style IN ('evidence', 'theory', 'empathy')),
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE INDEX IF NOT EXISTS idx_brain_staff_store ON public.brain_staff (store_id);

COMMENT ON COLUMN public.brain_staff.style IS
  'スタッフの提案スタイル: evidence=数値先行 / theory=機序先行 / empathy=共感先行';

-- ---------------------------------------------------------------
-- brain_customers (仕様書2-2)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.brain_customers (
  id                            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id                      uuid        NOT NULL REFERENCES public.brain_stores(id) ON DELETE CASCADE,
  name                          text        NOT NULL,
  age_group                     text,
  customer_type                 text        CHECK (customer_type IN ('A_acne', 'B_pore', 'C_sensitive', 'D_aging', 'E_bridal')),
  type_confidence                numeric    NOT NULL DEFAULT 0 CHECK (type_confidence BETWEEN 0 AND 1),
  goal_note                     text,
  wedding_date                  date,
  acquisition_channel           text,
  first_visit_date              date,
  assigned_staff_id             uuid        REFERENCES public.brain_staff(id) ON DELETE SET NULL,
  is_subscriber                 boolean     NOT NULL DEFAULT false,
  subscribed_at                 timestamptz,
  churn_score                   numeric     NOT NULL DEFAULT 0 CHECK (churn_score BETWEEN 0 AND 1),
  churn_reason                  text,
  consent_anonymized_learning   boolean     NOT NULL DEFAULT false,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  deleted_at                    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_brain_customers_store ON public.brain_customers (store_id);
CREATE INDEX IF NOT EXISTS idx_brain_customers_type ON public.brain_customers (customer_type);

-- ---------------------------------------------------------------
-- brain_menus
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.brain_menus (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      uuid        NOT NULL REFERENCES public.brain_stores(id) ON DELETE CASCADE,
  name          text        NOT NULL,
  price         integer     NOT NULL DEFAULT 0 CHECK (price >= 0),
  role          text        NOT NULL CHECK (role IN ('entry', 'pore', 'sensitive', 'peeling', 'lifting')),
  target_types  text[]      NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_brain_menus_store ON public.brain_menus (store_id);

-- ---------------------------------------------------------------
-- brain_bookings
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.brain_bookings (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      uuid        NOT NULL REFERENCES public.brain_stores(id) ON DELETE CASCADE,
  customer_id   uuid        NOT NULL REFERENCES public.brain_customers(id) ON DELETE CASCADE,
  staff_id      uuid        NOT NULL REFERENCES public.brain_staff(id) ON DELETE RESTRICT,
  booking_date  date        NOT NULL,
  source        text        NOT NULL CHECK (source IN ('in_salon', 'line', 'hotpepper', 'web')),
  status        text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done', 'cancelled', 'noshow')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_brain_bookings_store ON public.brain_bookings (store_id);
CREATE INDEX IF NOT EXISTS idx_brain_bookings_customer_date ON public.brain_bookings (customer_id, booking_date);
CREATE INDEX IF NOT EXISTS idx_brain_bookings_date ON public.brain_bookings (booking_date);

-- ---------------------------------------------------------------
-- brain_subscriptions
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.brain_subscriptions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      uuid        NOT NULL REFERENCES public.brain_stores(id) ON DELETE CASCADE,
  customer_id   uuid        NOT NULL REFERENCES public.brain_customers(id) ON DELETE CASCADE,
  plan_name     text        NOT NULL,
  monthly_price integer     NOT NULL DEFAULT 0 CHECK (monthly_price >= 0),
  started_at    date        NOT NULL,
  cancelled_at  date,
  cancel_reason text        CHECK (cancel_reason IN ('no_effect', 'price', 'distance', 'other')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_brain_subscriptions_store ON public.brain_subscriptions (store_id);
CREATE INDEX IF NOT EXISTS idx_brain_subscriptions_customer ON public.brain_subscriptions (customer_id);

-- ---------------------------------------------------------------
-- brain_visits (仕様書2-3)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.brain_visits (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id            uuid        NOT NULL REFERENCES public.brain_stores(id) ON DELETE CASCADE,
  customer_id         uuid        NOT NULL REFERENCES public.brain_customers(id) ON DELETE CASCADE,
  staff_id            uuid        NOT NULL REFERENCES public.brain_staff(id) ON DELETE RESTRICT,
  menu_id             uuid        NOT NULL REFERENCES public.brain_menus(id) ON DELETE RESTRICT,
  visit_date          date        NOT NULL,
  visit_count_at      integer     NOT NULL CHECK (visit_count_at >= 1),
  is_nomination       boolean     NOT NULL DEFAULT false,
  treatment_amount    integer     NOT NULL DEFAULT 0 CHECK (treatment_amount >= 0),
  retail_amount       integer     NOT NULL DEFAULT 0 CHECK (retail_amount >= 0),
  retail_category     text,
  homecare_purchased  boolean     NOT NULL DEFAULT false,
  homecare_declined   boolean     NOT NULL DEFAULT false,
  next_booking_made   boolean     NOT NULL DEFAULT false,
  no_booking_reason   text        CHECK (no_booking_reason IN ('considering', 'unsure', 'cold')),
  voice_memo_url      text,
  visit_score         integer     NOT NULL DEFAULT 0 CHECK (visit_score BETWEEN 0 AND 100),
  created_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

CREATE INDEX IF NOT EXISTS idx_brain_visits_customer_date ON public.brain_visits (customer_id, visit_date);
CREATE INDEX IF NOT EXISTS idx_brain_visits_store_date ON public.brain_visits (store_id, visit_date);

-- ---------------------------------------------------------------
-- brain_skin_records (仕様書2-4)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.brain_skin_records (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     uuid        NOT NULL REFERENCES public.brain_customers(id) ON DELETE CASCADE,
  visit_id        uuid        NOT NULL UNIQUE REFERENCES public.brain_visits(id) ON DELETE CASCADE,
  acne_level      smallint    CHECK (acne_level BETWEEN 0 AND 5),
  pore_level      smallint    CHECK (pore_level BETWEEN 0 AND 5),
  dryness_level   smallint    CHECK (dryness_level BETWEEN 0 AND 5),
  redness_level   smallint    CHECK (redness_level BETWEEN 0 AND 5),
  sagging_level   smallint    CHECK (sagging_level BETWEEN 0 AND 5),
  dullness_level  smallint    CHECK (dullness_level BETWEEN 0 AND 5),
  firmness_level  smallint    CHECK (firmness_level BETWEEN 0 AND 5),
  primary_delta   smallint,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brain_skin_records_customer ON public.brain_skin_records (customer_id);

COMMENT ON COLUMN public.brain_skin_records.primary_delta IS
  '顧客タイプの主要指標における今回値-初回値。VisitScoreCalculator/PatternContextBuilderのskin_improved判定に使用。';

-- ---------------------------------------------------------------
-- brain_business_settings
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.brain_business_settings (
  store_id            uuid        NOT NULL REFERENCES public.brain_stores(id) ON DELETE CASCADE,
  month               date        NOT NULL,
  sales_target        integer     NOT NULL DEFAULT 0,
  fixed_costs         integer,
  variable_cost_rate  numeric     NOT NULL DEFAULT 0 CHECK (variable_cost_rate >= 0 AND variable_cost_rate < 1),
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, month)
);

COMMENT ON COLUMN public.brain_business_settings.month IS
  '対象月の1日 (例: 2026-06-01)。';
COMMENT ON COLUMN public.brain_business_settings.fixed_costs IS
  'NULLの場合、nightly-dashboardはbreakeven関連の差分項目をNULLのまま出力する。';


-- ################################################################
-- # 20260612000002_pattern_tables.sql
-- ################################################################

-- ================================================================
-- Riora Brain Phase1 - Step1: 成功パターンテーブル
-- ================================================================

-- ---------------------------------------------------------------
-- brain_success_patterns
-- store_id = NULL はブランド標準パターン（全店舗で共有）。
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.brain_success_patterns (
  id                  text        PRIMARY KEY,
  store_id            uuid        REFERENCES public.brain_stores(id) ON DELETE CASCADE,
  customer_type       text        NOT NULL CHECK (customer_type IN ('A_acne', 'B_pore', 'C_sensitive', 'D_aging', 'E_bridal')),
  label               text        NOT NULL,
  entry_condition     jsonb       NOT NULL,
  target_cycle_days   integer     NOT NULL CHECK (target_cycle_days > 0),
  version             integer     NOT NULL DEFAULT 1,
  is_active           boolean     NOT NULL DEFAULT true,
  origin              text        NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'ai_discovered', 'brain_install')),
  approved_by         uuid,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brain_success_patterns_store ON public.brain_success_patterns (store_id);
CREATE INDEX IF NOT EXISTS idx_brain_success_patterns_type ON public.brain_success_patterns (customer_type);

COMMENT ON COLUMN public.brain_success_patterns.store_id IS
  'NULL=ブランド標準パターン（全店舗で参照可）。値ありは当該店舗専用パターン（自店学習による派生など）。';
COMMENT ON COLUMN public.brain_success_patterns.entry_condition IS
  'json-logic-js形式。PatternContext(snake_case変換後)に対してtrueならこのパターンに割当。';

-- ---------------------------------------------------------------
-- brain_pattern_steps
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.brain_pattern_steps (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_id      text        NOT NULL REFERENCES public.brain_success_patterns(id) ON DELETE CASCADE,
  step_no         integer     NOT NULL CHECK (step_no >= 1),
  label           text        NOT NULL,
  proposal_kind   text        NOT NULL CHECK (proposal_kind IN ('homecare', 'rebooking', 'subscription', 'upsell', 'pack', 'none')),
  menu_role       text        CHECK (menu_role IN ('entry', 'pore', 'sensitive', 'peeling', 'lifting')),
  fire_condition  jsonb       NOT NULL,
  base_script     text        NOT NULL DEFAULT '',
  cooldown_visits integer     NOT NULL DEFAULT 2 CHECK (cooldown_visits >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pattern_id, step_no)
);

CREATE INDEX IF NOT EXISTS idx_brain_pattern_steps_pattern ON public.brain_pattern_steps (pattern_id);

COMMENT ON COLUMN public.brain_pattern_steps.fire_condition IS
  'json-logic-js形式。PatternContextに対してtrueならこのstepの提案を発火。';
COMMENT ON COLUMN public.brain_pattern_steps.cooldown_visits IS
  'この提案が拒否された場合、次に再提案可能になるまでの最低来店回数。デフォルトはDEFAULT_COOLDOWN_VISITS(=2)と一致させる。';

-- ---------------------------------------------------------------
-- brain_pattern_progress (仕様書2-5)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.brain_pattern_progress (
  customer_id       uuid        PRIMARY KEY REFERENCES public.brain_customers(id) ON DELETE CASCADE,
  pattern_id        text        NOT NULL REFERENCES public.brain_success_patterns(id) ON DELETE RESTRICT,
  pattern_version   integer     NOT NULL DEFAULT 1,
  current_step      integer     NOT NULL DEFAULT 1 CHECK (current_step >= 1),
  entered_at        timestamptz NOT NULL DEFAULT now(),
  step_advanced_at  timestamptz,
  stalled_flag      boolean     NOT NULL DEFAULT false,
  completed         boolean     NOT NULL DEFAULT false,
  abandoned_reason  text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brain_pattern_progress_pattern ON public.brain_pattern_progress (pattern_id);

COMMENT ON COLUMN public.brain_pattern_progress.stalled_flag IS
  '停滞判定: daysSinceLast > avgCycle*2 (STALL_CYCLE_MULTIPLIER) または skinStagnant2 の場合true。';

-- ---------------------------------------------------------------
-- brain_staff_adjustments
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.brain_staff_adjustments (
  staff_id      uuid        NOT NULL REFERENCES public.brain_staff(id) ON DELETE CASCADE,
  pattern_id    text        NOT NULL REFERENCES public.brain_success_patterns(id) ON DELETE CASCADE,
  proposal_kind text        NOT NULL CHECK (proposal_kind IN ('homecare', 'rebooking', 'subscription', 'upsell', 'pack', 'none')),
  timing_offset integer     NOT NULL DEFAULT 0,
  script_style  text        CHECK (script_style IN ('evidence', 'theory', 'empathy')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_id, pattern_id, proposal_kind)
);

COMMENT ON COLUMN public.brain_staff_adjustments.timing_offset IS
  '正の値=発火タイミングを来店n回分後ろ倒し（fire_condition中のvisit_count系閾値に加算）。';


-- ################################################################
-- # 20260612000003_learning_tables.sql
-- ################################################################

-- ================================================================
-- Riora Brain Phase1 - Step1: 学習・運用キューテーブル
-- ================================================================

-- ---------------------------------------------------------------
-- brain_proposal_outcomes (仕様書2-6)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.brain_proposal_outcomes (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        uuid        NOT NULL REFERENCES public.brain_stores(id) ON DELETE CASCADE,
  customer_id     uuid        NOT NULL REFERENCES public.brain_customers(id) ON DELETE CASCADE,
  visit_id        uuid        NOT NULL REFERENCES public.brain_visits(id) ON DELETE CASCADE,
  staff_id        uuid        NOT NULL REFERENCES public.brain_staff(id) ON DELETE RESTRICT,
  pattern_id      text        NOT NULL REFERENCES public.brain_success_patterns(id) ON DELETE RESTRICT,
  step_no         integer     NOT NULL,
  proposal_kind   text        NOT NULL CHECK (proposal_kind IN ('homecare', 'rebooking', 'subscription', 'upsell', 'pack', 'none')),
  visit_count_at  integer     NOT NULL,
  was_briefed     boolean     NOT NULL DEFAULT false,
  was_executed    boolean     NOT NULL DEFAULT false,
  was_accepted    boolean     NOT NULL DEFAULT false,
  amount          integer     NOT NULL DEFAULT 0,
  customer_type   text        NOT NULL CHECK (customer_type IN ('A_acne', 'B_pore', 'C_sensitive', 'D_aging', 'E_bridal')),
  staff_style     text        NOT NULL CHECK (staff_style IN ('evidence', 'theory', 'empathy')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brain_proposal_outcomes_lookup
  ON public.brain_proposal_outcomes (store_id, customer_type, proposal_kind, visit_count_at);

COMMENT ON TABLE public.brain_proposal_outcomes IS
  'monthly-learningのセル集計(type×kind×visit_count_at×staff_style)の元データ。ProposalSuccessRate.rate()のn(=executed数)もここから算出。';

-- ---------------------------------------------------------------
-- brain_pattern_revisions (店舗ごとのLv2自己学習による改訂提案)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.brain_pattern_revisions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      uuid        NOT NULL REFERENCES public.brain_stores(id) ON DELETE CASCADE,
  pattern_id    text        NOT NULL REFERENCES public.brain_success_patterns(id) ON DELETE CASCADE,
  change_type   text        NOT NULL CHECK (change_type IN ('timing', 'condition', 'script', 'new_pattern', 'churn_weights', 'staff_adjustment')),
  before        jsonb       NOT NULL,
  after         jsonb       NOT NULL,
  evidence      jsonb       NOT NULL,
  status        text        NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'rejected', 'auto_applied')),
  decided_by    uuid,
  decided_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brain_pattern_revisions_pattern ON public.brain_pattern_revisions (pattern_id, status);

COMMENT ON TABLE public.brain_pattern_revisions IS
  '店舗単位のLv2改訂提案。起票前にLv4Validator.validateRevision()を必ず通過させること(DB制約では強制しない)。';
COMMENT ON COLUMN public.brain_pattern_revisions.evidence IS
  '{cells, n, rates}等、monthly-learningが算出した根拠数値一式。';

-- ---------------------------------------------------------------
-- brain_dashboard_daily
-- ---------------------------------------------------------------
-- 仕様書2-7のカラム詳細が未提供のため、3-A nightly-dashboard の出力項目
-- (月売上集計/着地予測/損益分岐点/各種率/segment_matrix/funnel/staff_matrix/
--  ai_insights) に基づき定義する。Step3でJSON形状の調整が必要な場合は
--  本マイグレーションを変更せず、ALTER TABLEで追記すること。
CREATE TABLE IF NOT EXISTS public.brain_dashboard_daily (
  store_id          uuid        NOT NULL REFERENCES public.brain_stores(id) ON DELETE CASCADE,
  snapshot_date     date        NOT NULL,
  monthly_sales     integer     NOT NULL DEFAULT 0,
  forecast_sales    integer     NOT NULL DEFAULT 0,
  breakeven_point   integer,
  repeat_rate_90d   numeric,
  rebooking_rate    numeric,
  homecare_rate     numeric,
  segment_matrix    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  funnel            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  staff_matrix      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  ai_insights       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, snapshot_date)
);

COMMENT ON COLUMN public.brain_dashboard_daily.breakeven_point IS
  'fixed_costs / (1 - variable_cost_rate)。business_settings.fixed_costsがNULLの場合はNULL。';

-- ---------------------------------------------------------------
-- brain_line_send_queue
-- 既存 public.line_send_queue とは別管理 (customers/customer_idの参照先が
-- brain_customers のため、テーブルを分離する)。
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.brain_line_send_queue (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        uuid        NOT NULL REFERENCES public.brain_stores(id) ON DELETE CASCADE,
  customer_id     uuid        NOT NULL REFERENCES public.brain_customers(id) ON DELETE CASCADE,
  message_draft   text        NOT NULL,
  trigger_type    text        NOT NULL,
  status          text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'sent', 'rejected')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brain_line_send_queue_status ON public.brain_line_send_queue (store_id, status);

-- ---------------------------------------------------------------
-- brain_evaluation_queue
-- saveVisitRecordでエンジン処理が例外を投げた場合の再評価キュー。
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.brain_evaluation_queue (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id    uuid        NOT NULL REFERENCES public.brain_visits(id) ON DELETE CASCADE,
  reason      text        NOT NULL,
  resolved    boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brain_evaluation_queue_unresolved
  ON public.brain_evaluation_queue (resolved)
  WHERE resolved = false;


-- ################################################################
-- # 20260612000004_brain_tables.sql
-- ################################################################

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


-- ################################################################
-- # 20260612000005_rls_policies.sql
-- ################################################################

-- ================================================================
-- Riora Brain Phase1 - Step1: RLSポリシー
--
-- 店舗系テーブル: store_id = current_setting('app.store_id', true)::uuid
-- (app.store_id未設定セッションでは0件、別storeのデータは不可視)
--
-- brain_* (ブランド横断) テーブル: service_roleのみ書込可
-- (Edge Functionはservice_roleで動作しRLSをバイパスするため、
--  関数内でstore_idを明示フィルタすること)。
-- ================================================================

-- 現在セッションのstore_id (app.store_id GUC) を取得するヘルパー。
-- 未設定 / 空文字の場合はNULLを返す(NULL比較は常にfalseとなり0件になる)。
CREATE OR REPLACE FUNCTION public.app_store_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.store_id', true), '')::uuid
$$;

-- ---------------------------------------------------------------
-- brain_stores (id = app.store_id)
-- ---------------------------------------------------------------
ALTER TABLE public.brain_stores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS brain_stores_self_access ON public.brain_stores;
CREATE POLICY brain_stores_self_access ON public.brain_stores
  FOR ALL
  USING (id = public.app_store_id())
  WITH CHECK (id = public.app_store_id());

-- ---------------------------------------------------------------
-- store_id を直接持つ店舗系テーブル
-- ---------------------------------------------------------------
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'brain_staff',
    'brain_customers',
    'brain_menus',
    'brain_bookings',
    'brain_subscriptions',
    'brain_visits',
    'brain_business_settings',
    'brain_proposal_outcomes',
    'brain_pattern_revisions',
    'brain_dashboard_daily',
    'brain_line_send_queue'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_store_isolation', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING (store_id = public.app_store_id()) WITH CHECK (store_id = public.app_store_id())',
      tbl || '_store_isolation', tbl
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------
-- brain_success_patterns (store_id NULL = ブランド標準。全店舗からSELECT可)
-- ---------------------------------------------------------------
ALTER TABLE public.brain_success_patterns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS brain_success_patterns_select ON public.brain_success_patterns;
CREATE POLICY brain_success_patterns_select ON public.brain_success_patterns
  FOR SELECT
  USING (store_id IS NULL OR store_id = public.app_store_id());

DROP POLICY IF EXISTS brain_success_patterns_write ON public.brain_success_patterns;
CREATE POLICY brain_success_patterns_write ON public.brain_success_patterns
  FOR ALL
  USING (store_id = public.app_store_id())
  WITH CHECK (store_id = public.app_store_id());

-- ---------------------------------------------------------------
-- store_idを直接持たないが、親テーブル経由でstore_idを辿れるテーブル
-- ---------------------------------------------------------------
ALTER TABLE public.brain_pattern_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS brain_pattern_steps_isolation ON public.brain_pattern_steps;
CREATE POLICY brain_pattern_steps_isolation ON public.brain_pattern_steps
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.brain_success_patterns sp
      WHERE sp.id = brain_pattern_steps.pattern_id
        AND (sp.store_id IS NULL OR sp.store_id = public.app_store_id())
    )
  );

ALTER TABLE public.brain_pattern_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS brain_pattern_progress_isolation ON public.brain_pattern_progress;
CREATE POLICY brain_pattern_progress_isolation ON public.brain_pattern_progress
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.brain_customers c
      WHERE c.id = brain_pattern_progress.customer_id
        AND c.store_id = public.app_store_id()
    )
  );

ALTER TABLE public.brain_skin_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS brain_skin_records_isolation ON public.brain_skin_records;
CREATE POLICY brain_skin_records_isolation ON public.brain_skin_records
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.brain_customers c
      WHERE c.id = brain_skin_records.customer_id
        AND c.store_id = public.app_store_id()
    )
  );

ALTER TABLE public.brain_staff_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS brain_staff_adjustments_isolation ON public.brain_staff_adjustments;
CREATE POLICY brain_staff_adjustments_isolation ON public.brain_staff_adjustments
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.brain_staff s
      WHERE s.id = brain_staff_adjustments.staff_id
        AND s.store_id = public.app_store_id()
    )
  );

ALTER TABLE public.brain_evaluation_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS brain_evaluation_queue_isolation ON public.brain_evaluation_queue;
CREATE POLICY brain_evaluation_queue_isolation ON public.brain_evaluation_queue
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.brain_visits v
      WHERE v.id = brain_evaluation_queue.visit_id
        AND v.store_id = public.app_store_id()
    )
  );

-- ---------------------------------------------------------------
-- brain_* ブランド横断テーブル
-- brain_events / brain_revisions: ポリシー無し
--   → authenticated/anonからは常に0件。service_role(RLSバイパス)のみ書込可。
-- brain_pattern_library: status='approved'のみ店舗ロールにSELECT許可
-- brain_benchmarks / brain_params: 店舗ロールに全件SELECT許可
-- ---------------------------------------------------------------
ALTER TABLE public.brain_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brain_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brain_pattern_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brain_benchmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brain_params ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS brain_pattern_library_read_approved ON public.brain_pattern_library;
CREATE POLICY brain_pattern_library_read_approved ON public.brain_pattern_library
  FOR SELECT
  USING (status = 'approved');

DROP POLICY IF EXISTS brain_benchmarks_read ON public.brain_benchmarks;
CREATE POLICY brain_benchmarks_read ON public.brain_benchmarks
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS brain_params_read ON public.brain_params;
CREATE POLICY brain_params_read ON public.brain_params
  FOR SELECT
  USING (true);

-- ---------------------------------------------------------------
-- テーブル権限 (RLSポリシーだけでは不十分。GRANTが無いと
-- "permission denied" / "table not found in schema cache" になる)
-- ---------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO authenticated, service_role;

DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename LIKE 'brain_%'
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated, service_role', tbl);
  END LOOP;
END $$;


-- ################################################################
-- # 20260612000006_seed_master.sql
-- ################################################################

-- ================================================================
-- Riora Brain Phase1 - Step1: マスタデータシード (新富町店)
--
-- ID規約: 1号店「新富町店」とその関連マスタは固定UUIDを用いる。
-- 20260612000007_seed_patterns.sql や Step2のテスト/シナリオから
-- 同じ値を参照できるようにするため。
--   store           00000000-0000-0000-0000-000000000001
--   staff 鈴木      00000000-0000-0000-0000-000000000101 (evidence)
--   staff 亀山      00000000-0000-0000-0000-000000000102 (theory)
--   staff 外舘      00000000-0000-0000-0000-000000000103 (empathy)
--   menu  entry     00000000-0000-0000-0000-000000000201 (ヒト幹15000)
--   menu  pore      00000000-0000-0000-0000-000000000202 (毛穴洗浄+ヒト幹19000)
--   menu  sensitive 00000000-0000-0000-0000-000000000203 (水素+ヒト幹18000)
--   menu  peeling   00000000-0000-0000-0000-000000000204 (ハーブピーリング9900)
--   menu  lifting   00000000-0000-0000-0000-000000000205 (EMS+小顔19000)
-- ================================================================

-- ---------------------------------------------------------------
-- 店舗: 新富町店
-- learning_mode = false: 1号店は自店学習(brain_pattern_libraryへの
-- フィードバック元)が正であり、ブランド標準パターンの自動上書きは行わない。
-- ---------------------------------------------------------------
INSERT INTO public.brain_stores (id, name, cluster, price_tier, brain_subscription, learning_mode)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '新富町店',
  'office_area',
  'standard',
  false,
  false
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------
-- スタッフ
-- ---------------------------------------------------------------
INSERT INTO public.brain_staff (id, store_id, name, style, is_active)
VALUES
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001', '鈴木', 'evidence', true),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000001', '亀山', 'theory', true),
  ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000001', '外舘', 'empathy', true)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------
-- メニュー
-- ---------------------------------------------------------------
INSERT INTO public.brain_menus (id, store_id, name, price, role, target_types)
VALUES
  ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000001', 'ヒト幹15000', 15000, 'entry',
    ARRAY['A_acne', 'B_pore', 'C_sensitive', 'D_aging', 'E_bridal']),
  ('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000001', '毛穴洗浄+ヒト幹19000', 19000, 'pore',
    ARRAY['B_pore']),
  ('00000000-0000-0000-0000-000000000203', '00000000-0000-0000-0000-000000000001', '水素+ヒト幹18000', 18000, 'sensitive',
    ARRAY['C_sensitive']),
  ('00000000-0000-0000-0000-000000000204', '00000000-0000-0000-0000-000000000001', 'ハーブピーリング9900', 9900, 'peeling',
    ARRAY['A_acne']),
  ('00000000-0000-0000-0000-000000000205', '00000000-0000-0000-0000-000000000001', 'EMS+小顔19000', 19000, 'lifting',
    ARRAY['D_aging'])
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------
-- 事業設定 (2026-06)
-- ---------------------------------------------------------------
INSERT INTO public.brain_business_settings (store_id, month, sales_target, fixed_costs, variable_cost_rate)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '2026-06-01',
  2500000,
  NULL,
  0.14
)
ON CONFLICT (store_id, month) DO NOTHING;


-- ################################################################
-- # 20260612000007_seed_patterns.sql
-- ################################################################

-- ================================================================
-- Riora Brain Phase1 - Step1: 成功パターン8件 + 各ステップシード
--
-- store_id = NULL (ブランド標準パターン)。1号店「新富町店」を含む全店舗が
-- 参照可能。fire_condition / entry_condition は PatternContext
-- (snake_case変換後) に対する json-logic-js ルール。
--
-- タスク分解書で明示された代表3例(そのまま採用):
--   - B1 step4 (サブスク提案条件): v_subscription
--   - C1 step3 (HC提案条件):       v_c_hc
--   - E1 entry_condition (逆算):   v_e1_entry
-- それ以外の条件は同じPatternContext語彙を用いて新規に構成したもの。
-- 成功パターンv2.0⑤の全文が入手でき次第、本マイグレーションは変更せず
-- UPDATE文を追加する形で内容を揃えること。
-- ================================================================

DO $$
DECLARE
  v_step1_active   jsonb := '{">=":[{"var":"visit_count"},1]}'::jsonb;
  v_common_hc      jsonb := '{"and":[{">=":[{"var":"visit_count"},2]},{"==":[{"var":"homecare_purchased_ever"},false]},{"==":[{"var":"homecare_declined_recent"},false]}]}'::jsonb;
  v_c_hc           jsonb := '{"and":[{">=":[{"var":"visit_count"},3]},{"==":[{"var":"skin_improved"},true]},{"==":[{"var":"homecare_declined_recent"},false]}]}'::jsonb;
  v_subscription   jsonb := '{"and":[{">=":[{"var":"visit_count"},4]},{">=":[{"var":"subsc_conditions_met"},4]},{"==":[{"var":"homecare_declined_recent"},false]},{"<":[{"var":"churn_score"},0.5]}]}'::jsonb;
  v_upsell         jsonb := '{"and":[{">=":[{"var":"visit_count"},3]},{"==":[{"var":"skin_improved"},true]},{"<":[{"var":"churn_score"},0.5]}]}'::jsonb;
  v_engaged_upsell jsonb := '{"and":[{">=":[{"var":"visit_count"},2]},{"==":[{"var":"homecare_declined_recent"},false]}]}'::jsonb;
  v_c1_upsell      jsonb := '{"and":[{">=":[{"var":"visit_count"},2]},{"==":[{"var":"skin_stagnant2"},false]}]}'::jsonb;
  v_rebooking      jsonb := '{"and":[{"==":[{"var":"next_booking_made_last"},false]},{">":[{"var":"churn_score"},0.4]}]}'::jsonb;
  v_pack_d2        jsonb := '{"and":[{">=":[{"var":"visit_count"},3]},{"==":[{"var":"is_nomination_streak2"},true]},{"==":[{"var":"homecare_declined_recent"},false]}]}'::jsonb;
  v_e1_entry       jsonb := '{"and":[{"!=":[{"var":"wedding_days_left"},null]},{"<=":[{"var":"wedding_days_left"},90]}]}'::jsonb;
  v_e1_step1       jsonb := '{"!=":[{"var":"wedding_days_left"},null]}'::jsonb;
  v_e1_step2       jsonb := '{"and":[{"!=":[{"var":"wedding_days_left"},null]},{"<=":[{"var":"wedding_days_left"},60]},{">=":[{"var":"visit_count"},2]}]}'::jsonb;
  v_e1_step3       jsonb := '{"and":[{"!=":[{"var":"wedding_days_left"},null]},{"<=":[{"var":"wedding_days_left"},30]},{"==":[{"var":"homecare_declined_recent"},false]}]}'::jsonb;

  v_kameyama       uuid := '00000000-0000-0000-0000-000000000102'; -- 亀山 (theory)
  v_sotodate       uuid := '00000000-0000-0000-0000-000000000103'; -- 外舘 (empathy)
BEGIN
  -- ---------------------------------------------------------------
  -- success_patterns
  -- ---------------------------------------------------------------
  INSERT INTO public.brain_success_patterns
    (id, store_id, customer_type, label, entry_condition, target_cycle_days, version, is_active, origin)
  VALUES
    ('A1', NULL, 'A_acne',      'ニキビケア・標準パターン',           '{"==":[1,1]}'::jsonb, 21, 1, true, 'manual'),
    ('A2', NULL, 'A_acne',      'ニキビケア・ホームケア定着型',       '{"==":[{"var":"homecare_purchased_ever"},true]}'::jsonb, 21, 1, true, 'manual'),
    ('B1', NULL, 'B_pore',      '毛穴ケア・標準パターン',             '{"==":[1,1]}'::jsonb, 28, 1, true, 'manual'),
    ('B2', NULL, 'B_pore',      '毛穴ケア・指名定着型',               '{"==":[{"var":"is_nomination_streak2"},true]}'::jsonb, 28, 1, true, 'manual'),
    ('C1', NULL, 'C_sensitive', '敏感肌ケア・標準パターン',           '{"==":[1,1]}'::jsonb, 35, 1, true, 'manual'),
    ('D1', NULL, 'D_aging',     'エイジングケア・標準パターン',       '{"==":[1,1]}'::jsonb, 28, 1, true, 'manual'),
    ('D2', NULL, 'D_aging',     'エイジングケア・離脱注意フォロー型', '{">=":[{"var":"churn_score"},0.5]}'::jsonb, 28, 1, true, 'manual'),
    ('E1', NULL, 'E_bridal',    'ブライダル逆算パターン',             v_e1_entry, 14, 1, true, 'manual')
  ON CONFLICT (id) DO NOTHING;

  -- ---------------------------------------------------------------
  -- pattern_steps: A1 (ニキビケア・標準パターン)
  -- ---------------------------------------------------------------
  INSERT INTO public.brain_pattern_steps
    (pattern_id, step_no, label, proposal_kind, menu_role, fire_condition, base_script, cooldown_visits)
  VALUES
    ('A1', 1, '初回カウンセリング・肌診断', 'none', 'entry', v_step1_active,
      '本日はヒト幹細胞コスメで肌のベースを整えていきますね。まずは現在の肌状態をしっかり記録し、次回以降の変化と比較できるようにします。', 0),
    ('A1', 2, 'ホームケア提案', 'homecare', NULL, v_common_hc,
      'ご自宅でのケアを取り入れていただくと、サロンでの効果がより長持ちします。今お使いの洗顔料に置き換えるだけで負担なく続けられるホームケアセットがございます。', 2),
    ('A1', 3, 'ピーリングメニュー提案(アップセル)', 'upsell', 'peeling', v_upsell,
      '肌の調子が安定してきましたね。次のステップとして、毛穴の詰まりや古い角質にアプローチするハーブピーリングを組み合わせると、さらに効果を実感しやすくなります。', 2),
    ('A1', 4, 'サブスクリプション提案', 'subscription', NULL, v_subscription,
      'ここまで継続して通っていただき、肌の変化を実感いただけていると思います。このペースを保つために、定額で通い放題になるサブスクプランがございます。長期的に見るとお得に続けられます。', 2)
  ON CONFLICT (pattern_id, step_no) DO NOTHING;

  -- ---------------------------------------------------------------
  -- pattern_steps: A2 (ニキビケア・ホームケア定着型)
  -- ---------------------------------------------------------------
  INSERT INTO public.brain_pattern_steps
    (pattern_id, step_no, label, proposal_kind, menu_role, fire_condition, base_script, cooldown_visits)
  VALUES
    ('A2', 1, 'ピーリングメニュー提案(アップセル)', 'upsell', 'peeling', v_engaged_upsell,
      'ホームケアを続けていただいているおかげで肌の土台が整ってきています。サロンでは角質ケアにフォーカスしたハーブピーリングを取り入れて、相乗効果を狙いましょう。', 2),
    ('A2', 2, '再来店促進(離脱防止)', 'rebooking', NULL, v_rebooking,
      '今のペースを崩さないことが、ニキビを繰り返さないための一番のポイントです。次回のご予約を早めに確保しておきましょう。', 2),
    ('A2', 3, 'サブスクリプション提案', 'subscription', NULL, v_subscription,
      'ホームケアとサロンケアの両輪がうまく回っていますね。このペースを継続しやすくするサブスクプランへの切り替えもご検討いただけます。', 2)
  ON CONFLICT (pattern_id, step_no) DO NOTHING;

  -- ---------------------------------------------------------------
  -- pattern_steps: B1 (毛穴ケア・標準パターン)
  -- ---------------------------------------------------------------
  INSERT INTO public.brain_pattern_steps
    (pattern_id, step_no, label, proposal_kind, menu_role, fire_condition, base_script, cooldown_visits)
  VALUES
    ('B1', 1, '初回カウンセリング・肌診断', 'none', 'entry', v_step1_active,
      '毛穴の目立ちが気になる肌質ですので、まずはヒト幹細胞コスメで土台を整えながら、毛穴の状態を継続的に記録していきましょう。', 0),
    ('B1', 2, 'ホームケア提案', 'homecare', NULL, v_common_hc,
      '毛穴の引き締めは日々の積み重ねが重要です。サロンでのケアに加えて、ご自宅でも使える収れん化粧水を取り入れることで効果の持続が期待できます。', 2),
    ('B1', 3, '毛穴洗浄メニュー提案(アップセル)', 'upsell', 'pore', v_upsell,
      '毛穴の状態が少しずつ変化してきていますね。毛穴洗浄+ヒト幹のメニューに切り替えることで、さらに集中的にアプローチできます。', 2),
    ('B1', 4, 'サブスクリプション提案', 'subscription', NULL, v_subscription,
      '毛穴ケアは続けることで結果が出てきます。定額で通い放題のサブスクプランにすると、ペースを落とさずに続けやすくなります。', 2)
  ON CONFLICT (pattern_id, step_no) DO NOTHING;

  -- ---------------------------------------------------------------
  -- pattern_steps: B2 (毛穴ケア・指名定着型)
  -- ---------------------------------------------------------------
  INSERT INTO public.brain_pattern_steps
    (pattern_id, step_no, label, proposal_kind, menu_role, fire_condition, base_script, cooldown_visits)
  VALUES
    ('B2', 1, '毛穴洗浄メニュー提案(アップセル)', 'upsell', 'pore', v_engaged_upsell,
      'いつもご指名いただきありがとうございます。信頼関係ができてきましたので、より集中的に毛穴にアプローチする毛穴洗浄+ヒト幹のメニューをご提案します。', 2),
    ('B2', 2, 'ホームケア提案', 'homecare', NULL, v_common_hc,
      'サロンでのケアの効果を持続させるために、ご自宅でも使える収れん化粧水をお使いいただくのがおすすめです。', 2),
    ('B2', 3, 'サブスクリプション提案', 'subscription', NULL, v_subscription,
      'いつも継続してご来店いただいているので、サブスクプランに切り替えるとお得に通い続けられます。', 2)
  ON CONFLICT (pattern_id, step_no) DO NOTHING;

  -- ---------------------------------------------------------------
  -- pattern_steps: C1 (敏感肌ケア・標準パターン)
  -- ---------------------------------------------------------------
  INSERT INTO public.brain_pattern_steps
    (pattern_id, step_no, label, proposal_kind, menu_role, fire_condition, base_script, cooldown_visits)
  VALUES
    ('C1', 1, '初回カウンセリング・肌診断', 'none', 'entry', v_step1_active,
      '敏感肌の方には、まず低刺激のヒト幹細胞コスメで肌のバリア機能を整えることを優先します。お肌の反応を見ながら少しずつステップを進めていきましょう。', 0),
    ('C1', 2, '水素ケアメニュー提案(アップセル)', 'upsell', 'sensitive', v_c1_upsell,
      'お肌の調子が落ち着いてきましたので、次回は水素+ヒト幹のメニューで、より鎮静効果の高いケアを試してみませんか。', 2),
    ('C1', 3, 'ホームケア提案', 'homecare', NULL, v_c_hc,
      'お肌の状態が安定して改善が見られていますので、このタイミングでご自宅用の低刺激ケアアイテムを取り入れると、変化をより実感しやすくなります。', 2),
    ('C1', 4, 'サブスクリプション提案', 'subscription', NULL, v_subscription,
      '敏感肌は環境の変化で揺らぎやすいので、定期的なケアを継続しやすいサブスクプランをご検討いただくと安心です。', 2)
  ON CONFLICT (pattern_id, step_no) DO NOTHING;

  -- ---------------------------------------------------------------
  -- pattern_steps: D1 (エイジングケア・標準パターン)
  -- ---------------------------------------------------------------
  INSERT INTO public.brain_pattern_steps
    (pattern_id, step_no, label, proposal_kind, menu_role, fire_condition, base_script, cooldown_visits)
  VALUES
    ('D1', 1, '初回カウンセリング・肌診断', 'none', 'entry', v_step1_active,
      'エイジングケアは早めの土台作りが重要です。まずはヒト幹細胞コスメで肌のハリと潤いを底上げしていきましょう。', 0),
    ('D1', 2, 'ホームケア提案', 'homecare', NULL, v_common_hc,
      'サロンでのケアと並行して、ご自宅でもハリ・弾力をサポートする美容液を取り入れることで、効果の実感が早くなります。', 2),
    ('D1', 3, 'EMS+小顔メニュー提案(アップセル)', 'upsell', 'lifting', v_upsell,
      'お肌のハリに変化が出てきていますね。EMS+小顔のメニューを組み合わせることで、引き締め効果もプラスできます。', 2),
    ('D1', 4, 'サブスクリプション提案', 'subscription', NULL, v_subscription,
      'エイジングケアは継続が何より大切です。サブスクプランに切り替えることで、無理なく定期的なケアを続けていただけます。', 2)
  ON CONFLICT (pattern_id, step_no) DO NOTHING;

  -- ---------------------------------------------------------------
  -- pattern_steps: D2 (エイジングケア・離脱注意フォロー型)
  -- ---------------------------------------------------------------
  INSERT INTO public.brain_pattern_steps
    (pattern_id, step_no, label, proposal_kind, menu_role, fire_condition, base_script, cooldown_visits)
  VALUES
    ('D2', 1, '再来店促進(離脱防止)', 'rebooking', NULL, v_rebooking,
      'しばらく間が空いてしまうと、せっかくのエイジングケアの効果が戻りやすくなってしまいます。今のうちに次回のご予約を確保しておきませんか。', 2),
    ('D2', 2, 'EMS+小顔メニュー提案(パック)', 'pack', 'lifting', v_pack_d2,
      '続けてご来店いただけると効果が出やすくなります。EMS+小顔メニューを複数回パックでお得にご利用いただけるプランがございます。', 2),
    ('D2', 3, 'ホームケア提案', 'homecare', NULL, v_common_hc,
      'ご来店の間隔が空いてしまっても自宅でケアを続けられるよう、ハリ・弾力をサポートする美容液をお取り入れいただくのがおすすめです。', 2)
  ON CONFLICT (pattern_id, step_no) DO NOTHING;

  -- ---------------------------------------------------------------
  -- pattern_steps: E1 (ブライダル逆算パターン)
  -- ---------------------------------------------------------------
  INSERT INTO public.brain_pattern_steps
    (pattern_id, step_no, label, proposal_kind, menu_role, fire_condition, base_script, cooldown_visits)
  VALUES
    ('E1', 1, 'ブライダル逆算カウンセリング', 'none', 'entry', v_e1_step1,
      '挙式までの日数から逆算して、最適なケアスケジュールをご提案します。まずは現在のお肌の状態を確認し、ゴールに向けたプランを一緒に組み立てていきましょう。', 0),
    ('E1', 2, '集中ケアメニュー提案(パック)', 'pack', NULL, v_e1_step2,
      '挙式まで残り少なくなってきましたので、集中ケアパックで仕上げに向けたスケジュールを組みましょう。', 1),
    ('E1', 3, 'ホームケア提案', 'homecare', NULL, v_e1_step3,
      '本番直前は肌のコンディションを毎日キープすることが大切です。当日まで使えるホームケアアイテムで仕上げのお手入れを続けましょう。', 1)
  ON CONFLICT (pattern_id, step_no) DO NOTHING;

  -- ---------------------------------------------------------------
  -- staff_adjustments
  --  亀山×(A1,A2,C1)×homecare timing_offset=+1
  --  外舘×全パターン×homecare timing_offset=+1
  --  外舘×C1×subscription script_style='empathy'
  -- ---------------------------------------------------------------
  INSERT INTO public.brain_staff_adjustments
    (staff_id, pattern_id, proposal_kind, timing_offset, script_style)
  VALUES
    (v_kameyama, 'A1', 'homecare', 1, NULL),
    (v_kameyama, 'A2', 'homecare', 1, NULL),
    (v_kameyama, 'C1', 'homecare', 1, NULL),
    (v_sotodate, 'A1', 'homecare', 1, NULL),
    (v_sotodate, 'A2', 'homecare', 1, NULL),
    (v_sotodate, 'B1', 'homecare', 1, NULL),
    (v_sotodate, 'B2', 'homecare', 1, NULL),
    (v_sotodate, 'C1', 'homecare', 1, NULL),
    (v_sotodate, 'D1', 'homecare', 1, NULL),
    (v_sotodate, 'D2', 'homecare', 1, NULL),
    (v_sotodate, 'E1', 'homecare', 1, NULL),
    (v_sotodate, 'C1', 'subscription', 0, 'empathy')
  ON CONFLICT (staff_id, pattern_id, proposal_kind) DO NOTHING;
  -- 鈴木(evidence, 00000000-0000-0000-0000-000000000101)はデフォルトスタイルのため調整レコードなし。
END $$;


-- ################################################################
-- # 20260612000008_w8_pattern_engine.sql
-- ################################################################

-- ================================================================
-- Riora Brain Phase2 - W8: Success Pattern Final Architecture v1.0
-- 列追加(5テーブル) + pattern_fire_log新設 + pattern_step_stats matview
-- + brain_paramsシード(fire_score_weights/style_affinity/lifecycle_thresholds)
--
-- 対象範囲: 店内提案(in_store)のみ。brain_scenarios / scenario_outcomes /
-- scenario_trigger_log (DM側) は後続実装のため本マイグレーションでは扱わない。
-- ================================================================

-- ---------------------------------------------------------------
-- 1. brain_success_patterns: lifecycle_status / lifecycle_changed_at
-- 「候補(Candidate)」のライフサイクルはstep単位ではなくpattern単位で
-- 管理する(3-1の状態機械はpattern全体に対する遷移)。
-- ---------------------------------------------------------------
ALTER TABLE public.brain_success_patterns
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'active'
    CHECK (lifecycle_status IN ('candidate','testing','active','watch','demoted','suspended')),
  ADD COLUMN IF NOT EXISTS lifecycle_changed_at timestamptz;

-- ---------------------------------------------------------------
-- 2. brain_pattern_steps: soft_features / optimal_visit
-- ---------------------------------------------------------------
ALTER TABLE public.brain_pattern_steps
  ADD COLUMN IF NOT EXISTS soft_features jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS optimal_visit integer;

COMMENT ON COLUMN public.brain_pattern_steps.soft_features IS
  'Success Pattern Final v1.0 1-1。{ weights: Record<FeatureName, number> } 形式でcontextFitの特徴重みを保持(timing_proximityはw3で別枠のためweightsからは除く)。';
COMMENT ON COLUMN public.brain_pattern_steps.optimal_visit IS
  'timing_proximityの中心値(σ=1)。PatternScorerが exp(-((visit_count-optimal_visit)^2)/2) で使用。';

-- ---------------------------------------------------------------
-- 3. brain_pattern_progress: assign_score / switch_candidate / switch_streak
-- ---------------------------------------------------------------
ALTER TABLE public.brain_pattern_progress
  ADD COLUMN IF NOT EXISTS assign_score numeric,
  ADD COLUMN IF NOT EXISTS switch_candidate text,
  ADD COLUMN IF NOT EXISTS switch_streak integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.brain_pattern_progress.switch_streak IS
  'Success Pattern Final v1.0 2-3 ケース1。新パターンのAssignScoreが現行+0.15を上回った連続評価回数。2に達するとabandoned+切替。';

-- ---------------------------------------------------------------
-- 4. brain_proposal_outcomes: fire_score / decisive_factor
-- ---------------------------------------------------------------
ALTER TABLE public.brain_proposal_outcomes
  ADD COLUMN IF NOT EXISTS fire_score numeric,
  ADD COLUMN IF NOT EXISTS decisive_factor text;

COMMENT ON COLUMN public.brain_proposal_outcomes.fire_score IS
  'Success Pattern Final v1.0 1-2。当時のFireScore(0-100)。較正回帰の入力。';
COMMENT ON COLUMN public.brain_proposal_outcomes.decisive_factor IS
  'ExplainabilityEngineが判定したdecisive_factor(score_breakdown最大寄与項)。';

-- ---------------------------------------------------------------
-- 5. brain_staff_adjustments: affinity_score
-- ---------------------------------------------------------------
ALTER TABLE public.brain_staff_adjustments
  ADD COLUMN IF NOT EXISTS affinity_score numeric CHECK (affinity_score BETWEEN 0 AND 1);

COMMENT ON COLUMN public.brain_staff_adjustments.affinity_score IS
  'Success Pattern Final v1.0 1-2 w4(StaffAffinity)の実測EWMA値。NULLの場合はbrain_params(style_affinity)のpriorを使用。';

-- ---------------------------------------------------------------
-- 6. brain_pattern_fire_log(新設)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.brain_pattern_fire_log (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        uuid        NOT NULL REFERENCES public.brain_stores(id) ON DELETE CASCADE,
  customer_id     uuid        NOT NULL REFERENCES public.brain_customers(id) ON DELETE CASCADE,
  visit_id        uuid        REFERENCES public.brain_visits(id) ON DELETE SET NULL,
  decision_record jsonb       NOT NULL,
  explanation     text        NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brain_pattern_fire_log_customer ON public.brain_pattern_fire_log (customer_id, created_at DESC);

COMMENT ON TABLE public.brain_pattern_fire_log IS
  'Success Pattern Final v1.0 4章。ConflictResolver通過時にDecisionRecord+説明文を保存(Manager向けfire-log画面・Explainability evidence参照元)。';

ALTER TABLE public.brain_pattern_fire_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS brain_pattern_fire_log_store_isolation ON public.brain_pattern_fire_log;
CREATE POLICY brain_pattern_fire_log_store_isolation ON public.brain_pattern_fire_log
  FOR ALL
  USING (store_id = public.app_store_id())
  WITH CHECK (store_id = public.app_store_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.brain_pattern_fire_log TO authenticated, service_role;

-- ---------------------------------------------------------------
-- 7. brain_pattern_step_stats(マテリアライズドビュー)
-- 店内候補(brain_pattern_steps)のセル統計。DM側(scenario_outcomes)は
-- brain_scenarios未実装のため後続migrationでUNIONする。
-- セル粒度はPatternScorerのcellKey(candidate, customerType, staffStyle)に合わせ
-- (pattern_id, step_no, customer_type, staff_style)。ブランド横断集計
-- (brain_benchmarksと同様に店舗ロールへ全件SELECT許可・n>=10判定のベースライン)。
-- ---------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS public.brain_pattern_step_stats AS
SELECT
  (po.pattern_id || '-step' || po.step_no::text) AS candidate_code,
  po.pattern_id,
  po.step_no,
  po.customer_type,
  po.staff_style,
  count(*)::integer AS executed_n,
  count(*) FILTER (WHERE po.was_accepted)::integer AS accepted_n,
  ((count(*) FILTER (WHERE po.was_accepted))::numeric + 1)
    / ((count(*))::numeric + 3) AS laplace_rate,
  NULL::numeric AS repeat_rate_90d,
  avg(po.fire_score) AS avg_fire_score
FROM public.brain_proposal_outcomes po
WHERE po.was_executed = true
GROUP BY po.pattern_id, po.step_no, po.customer_type, po.staff_style;

CREATE UNIQUE INDEX IF NOT EXISTS idx_brain_pattern_step_stats_cell
  ON public.brain_pattern_step_stats (candidate_code, customer_type, staff_style);

COMMENT ON MATERIALIZED VIEW public.brain_pattern_step_stats IS
  'Success Pattern Final v1.0 5-2。PatternScorer.SuccessRate*(laplace_rate, n=executed_n)の入力。monthly-learning冒頭でREFRESH MATERIALIZED VIEW CONCURRENTLY。';

GRANT SELECT ON TABLE public.brain_pattern_step_stats TO authenticated, service_role;

-- ---------------------------------------------------------------
-- 8. brain_params シード(fire_score_weights / style_affinity / lifecycle_thresholds)
-- cluster='office_area'(新富町店)。Phase1は参照のみ・Lv3起票で更新される。
-- ---------------------------------------------------------------
INSERT INTO public.brain_params (key, cluster, version, value)
VALUES
  ('fire_score_weights', 'office_area', 1,
    '{"w1":0.30,"w2":0.20,"w3":0.20,"w4":0.15,"w5":0.15}'::jsonb),
  ('style_affinity', 'office_area', 1,
    '{"evidence":{"homecare":0.5,"rebooking":0.5,"subscription":0.5,"upsell":0.5,"pack":0.5,"none":0.5},
      "theory":{"homecare":0.5,"rebooking":0.5,"subscription":0.5,"upsell":0.5,"pack":0.5,"none":0.5},
      "empathy":{"homecare":0.5,"rebooking":0.5,"subscription":0.5,"upsell":0.5,"pack":0.5,"none":0.5}}'::jsonb),
  ('lifecycle_thresholds', 'office_area', 1,
    '{"promotion":{"liftPt":10,"evaluationDays":60,"minN":20},
      "watchDemotion":{"benchmarkPercentile":25,"dropPt":20,"minN":20},
      "watchRecovery":{"periods":2,"periodDays":60,"minN":15},
      "demotion":{"watchDays":90,"minN":20},
      "suspension":{"acceptRateMin":0.10,"minN":15,"rejectRateMax":0.50,"rejectMinN":10}}'::jsonb)
ON CONFLICT (key, cluster, version) DO NOTHING;

-- ---------------------------------------------------------------
-- 9. 既存pattern_steps(8パターン28step)のoptimal_visit/soft_features初期値
-- soft_featuresは1-1のcontextFit入力5特徴(timing_proximityはw3で別枠)への
-- 既定重み(均等0.2)。optimal_visitは各stepのfire_condition visit_count閾値
-- (閾値を持たないstepは登場順を踏まえた近似値)。
-- ---------------------------------------------------------------
UPDATE public.brain_pattern_steps
SET soft_features = '{"weights":{"cycle_position":0.2,"condition_margin":0.2,"type_confidence":0.2,"csi_alignment":0.2,"skin_momentum":0.2}}'::jsonb
WHERE soft_features = '{}'::jsonb;

UPDATE public.brain_pattern_steps AS bps
SET optimal_visit = v.optimal_visit
FROM (VALUES
  ('A1',1,1), ('A1',2,2), ('A1',3,3), ('A1',4,4),
  ('A2',1,2), ('A2',2,2), ('A2',3,4),
  ('B1',1,1), ('B1',2,2), ('B1',3,3), ('B1',4,4),
  ('B2',1,2), ('B2',2,2), ('B2',3,4),
  ('C1',1,1), ('C1',2,2), ('C1',3,3), ('C1',4,4),
  ('D1',1,1), ('D1',2,2), ('D1',3,3), ('D1',4,4),
  ('D2',1,2), ('D2',2,3), ('D2',3,2),
  ('E1',1,1), ('E1',2,2), ('E1',3,3)
) AS v(pattern_id, step_no, optimal_visit)
WHERE bps.pattern_id = v.pattern_id AND bps.step_no = v.step_no
  AND bps.optimal_visit IS NULL;


-- ################################################################
-- # 20260612000009_brain_scenarios.sql
-- ################################################################

-- ================================================================
-- Riora Brain Phase2 - Repository & RPC Layer: brain_scenarios新設
--
-- 不足Repository洗い出し(ScenarioRepo)で判明したスキーマギャップを埋める。
-- ScenarioSelector(Step2-2)が要求するScenarioCandidateRow
-- (scenarioCode/priority/customerType/channel/updatedAt/lastSentAt)のうち、
-- lastSentAt以外はbrain_scenariosから取得する。
-- brain_success_patterns(店内)と対になるDM候補マスタ。store_id NULL =
-- ブランド標準シナリオ(全店舗で共有)。
-- ================================================================

CREATE TABLE IF NOT EXISTS public.brain_scenarios (
  id            text        PRIMARY KEY,
  store_id      uuid        REFERENCES public.brain_stores(id) ON DELETE CASCADE,
  customer_type text        NOT NULL CHECK (customer_type IN ('A_acne', 'B_pore', 'C_sensitive', 'D_aging', 'E_bridal')),
  priority      text        NOT NULL CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  channel       text        NOT NULL CHECK (channel IN ('LINE', 'SMS', 'EMAIL')),
  label         text        NOT NULL DEFAULT '',
  is_active     boolean     NOT NULL DEFAULT true,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brain_scenarios_store ON public.brain_scenarios (store_id);
CREATE INDEX IF NOT EXISTS idx_brain_scenarios_type ON public.brain_scenarios (customer_type);

COMMENT ON COLUMN public.brain_scenarios.store_id IS
  'NULL=ブランド標準シナリオ(全店舗で参照可)。値ありは当該店舗専用シナリオ。';
COMMENT ON COLUMN public.brain_scenarios.id IS
  'scenario_code(例: S-001)。ScenarioCandidateRow.scenarioCode / brain_line_send_queue.trigger_typeと対応。';

ALTER TABLE public.brain_scenarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS brain_scenarios_select ON public.brain_scenarios;
CREATE POLICY brain_scenarios_select ON public.brain_scenarios
  FOR SELECT
  USING (store_id IS NULL OR store_id = public.app_store_id());

DROP POLICY IF EXISTS brain_scenarios_write ON public.brain_scenarios;
CREATE POLICY brain_scenarios_write ON public.brain_scenarios
  FOR ALL
  USING (store_id = public.app_store_id())
  WITH CHECK (store_id = public.app_store_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.brain_scenarios TO authenticated, service_role;

-- ---------------------------------------------------------------
-- brain_line_send_queue: template_id / scheduled_at列を追加
--
-- LineSendQueuePayload(ScenarioQueueBuilder)はtemplate_id/scheduled_atを
-- 持つが既存brain_line_send_queueには列が無いため不足分を追加する。
-- message_draftは送信文言の確定をsend worker側に委ねるため、Repository層
-- (LineQueueRepo)からの挿入時はNOT NULL制約を外し空文字を許容する。
-- ---------------------------------------------------------------
ALTER TABLE public.brain_line_send_queue
  ADD COLUMN IF NOT EXISTS template_id text,
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ALTER COLUMN message_draft DROP NOT NULL,
  ALTER COLUMN message_draft SET DEFAULT '';

COMMENT ON COLUMN public.brain_line_send_queue.template_id IS
  'LineSendQueuePayload.template_id。本文はsend worker側でtemplate_id+変数から組み立てる。';
COMMENT ON COLUMN public.brain_line_send_queue.scheduled_at IS
  'LineSendQueuePayload.scheduled_at。';

-- ================================================================
-- Phase 0 適用完了。
-- 次のステップ: Phase 1 (20260620_w19_dashboard_diff.sql) を別途実行。
-- ================================================================
