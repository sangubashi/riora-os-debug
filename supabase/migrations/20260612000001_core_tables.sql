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
