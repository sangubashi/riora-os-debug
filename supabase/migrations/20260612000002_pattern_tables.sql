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
