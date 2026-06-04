-- ============================================================
--  KPI Tables  –  Salon Riora OS
--  Run:  supabase db push  or  psql < this_file.sql
-- ============================================================

-- ── 日次KPIスナップショット ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_kpi_snapshots (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  date                   date        NOT NULL UNIQUE,

  -- 売上
  total_sales            integer     NOT NULL DEFAULT 0,
  treatment_count        integer     NOT NULL DEFAULT 0,
  avg_spend              integer     NOT NULL DEFAULT 0,   -- computed or stored

  -- 率 (0.00 – 100.00)
  next_booking_rate      numeric(5,2) NOT NULL DEFAULT 0,
  repeat_rate            numeric(5,2) NOT NULL DEFAULT 0,
  line_reply_rate        numeric(5,2) NOT NULL DEFAULT 0,
  subscription_retention numeric(5,2) NOT NULL DEFAULT 0,

  created_at             timestamptz DEFAULT now(),
  updated_at             timestamptz DEFAULT now()
);

COMMENT ON TABLE  daily_kpi_snapshots                     IS 'KPIダッシュボード用の日次集計スナップショット';
COMMENT ON COLUMN daily_kpi_snapshots.next_booking_rate   IS '施術後に次回予約を取得できた割合 (%)';
COMMENT ON COLUMN daily_kpi_snapshots.repeat_rate         IS '6ヶ月以内に2回以上来店した顧客の割合 (%)';
COMMENT ON COLUMN daily_kpi_snapshots.line_reply_rate     IS 'LINEメッセージへの48時間以内返信率 (%)';
COMMENT ON COLUMN daily_kpi_snapshots.subscription_retention IS 'サブスクプランの継続率 (%)';

-- ── 週次売上グラフ用 ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS weekly_sales (
  id           uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start   date     NOT NULL,
  day_of_week  smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=月
  day_label    text     NOT NULL,                                      -- '月','火'...
  sales        integer  NOT NULL DEFAULT 0,
  reservations integer  NOT NULL DEFAULT 0,
  created_at   timestamptz DEFAULT now(),
  UNIQUE (week_start, day_of_week)
);

-- ── スタッフ日次ランキング ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_daily_rankings (
  id                  uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
  date                date     NOT NULL,
  staff_id            text     NOT NULL,
  staff_name          text     NOT NULL,
  today_sales         integer  DEFAULT 0,
  next_reserve_count  integer  DEFAULT 0,
  ai_adopt_rate       numeric(5,2) DEFAULT 0,
  rank                smallint,
  created_at          timestamptz DEFAULT now(),
  UNIQUE (date, staff_id)
);

-- ── AI改善インサイト ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kpi_insights (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type       text NOT NULL CHECK (type IN ('warning','tip','praise')),
  message    text NOT NULL,
  action     text,
  is_active  boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- ── 自動updated_at ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_daily_kpi_updated_at ON daily_kpi_snapshots;
CREATE TRIGGER trg_daily_kpi_updated_at
  BEFORE UPDATE ON daily_kpi_snapshots
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── インデックス ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_daily_kpi_date       ON daily_kpi_snapshots (date DESC);
CREATE INDEX IF NOT EXISTS idx_weekly_sales_week    ON weekly_sales         (week_start DESC);
CREATE INDEX IF NOT EXISTS idx_staff_rank_date      ON staff_daily_rankings  (date DESC, rank ASC);
