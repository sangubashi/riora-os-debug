-- ============================================================
--  Row Level Security Policies  –  Salon Riora OS
--  認証済みユーザーのみ読み書き可能
-- ============================================================

-- KPI
ALTER TABLE daily_kpi_snapshots  ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_sales          ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_daily_rankings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_insights          ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read kpi snapshots"    ON daily_kpi_snapshots  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth write kpi snapshots"   ON daily_kpi_snapshots  FOR ALL    USING (auth.role() = 'authenticated');
CREATE POLICY "auth read weekly sales"     ON weekly_sales          FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth write weekly sales"    ON weekly_sales          FOR ALL    USING (auth.role() = 'authenticated');
CREATE POLICY "auth read staff rankings"   ON staff_daily_rankings  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth write staff rankings"  ON staff_daily_rankings  FOR ALL    USING (auth.role() = 'authenticated');
CREATE POLICY "auth read kpi insights"     ON kpi_insights          FOR SELECT USING (auth.role() = 'authenticated');

-- LINE
ALTER TABLE line_threads    ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_messages   ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_segments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_templates  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read threads"      ON line_threads    FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth write threads"     ON line_threads    FOR ALL    USING (auth.role() = 'authenticated');
CREATE POLICY "auth read messages"     ON line_messages   FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth write messages"    ON line_messages   FOR ALL    USING (auth.role() = 'authenticated');
CREATE POLICY "auth read segments"     ON line_segments   FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth read broadcasts"   ON line_broadcasts FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth write broadcasts"  ON line_broadcasts FOR ALL    USING (auth.role() = 'authenticated');
CREATE POLICY "auth read templates"    ON line_templates  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth write templates"   ON line_templates  FOR ALL    USING (auth.role() = 'authenticated');

-- Menu
ALTER TABLE salon_menus          ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_menu_options   ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_subscriptions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_menu_analytics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read menus"         ON salon_menus          FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth write menus"        ON salon_menus          FOR ALL    USING (auth.role() = 'authenticated');
CREATE POLICY "auth read menu options"  ON salon_menu_options   FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth write menu options" ON salon_menu_options   FOR ALL    USING (auth.role() = 'authenticated');
CREATE POLICY "auth read subs"          ON salon_subscriptions  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth write subs"         ON salon_subscriptions  FOR ALL    USING (auth.role() = 'authenticated');
CREATE POLICY "auth read analytics"     ON salon_menu_analytics FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "auth write analytics"    ON salon_menu_analytics FOR ALL    USING (auth.role() = 'authenticated');
