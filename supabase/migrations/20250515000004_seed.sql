-- ============================================================
--  Seed Data  –  開発・デモ用サンプルデータ
--  ※本番環境では実行しないこと
-- ============================================================

-- ── KPI スナップショット (過去7日) ─────────────────────────────────
INSERT INTO daily_kpi_snapshots
  (date, total_sales, treatment_count, avg_spend,
   next_booking_rate, repeat_rate, line_reply_rate, subscription_retention)
VALUES
  (CURRENT_DATE,     128000, 9, 14222, 62.0, 78.0, 84.0, 91.0),
  (CURRENT_DATE - 1, 105000, 8, 13125, 71.0, 80.0, 79.0, 91.0),
  (CURRENT_DATE - 2, 156000,10, 15600, 75.0, 77.0, 82.0, 90.0),
  (CURRENT_DATE - 3, 134000, 9, 14889, 68.0, 79.0, 85.0, 91.0),
  (CURRENT_DATE - 4,  88000, 6, 14667, 60.0, 75.0, 78.0, 89.0),
  (CURRENT_DATE - 5, 112000, 8, 14000, 72.0, 76.0, 81.0, 90.0),
  (CURRENT_DATE - 6,  95000, 7, 13571, 65.0, 74.0, 80.0, 91.0)
ON CONFLICT (date) DO UPDATE SET
  total_sales  = EXCLUDED.total_sales,
  updated_at   = now();

-- ── 週次売上 ─────────────────────────────────────────────────────
WITH week_base AS (
  SELECT date_trunc('week', CURRENT_DATE)::date AS ws
)
INSERT INTO weekly_sales (week_start, day_of_week, day_label, sales, reservations)
SELECT
  ws,
  n,
  CASE n WHEN 0 THEN '月' WHEN 1 THEN '火' WHEN 2 THEN '水'
          WHEN 3 THEN '木' WHEN 4 THEN '金' WHEN 5 THEN '土'
          ELSE '今日' END,
  (ARRAY[95000,112000,88000,134000,156000,198000,128000])[n+1],
  (ARRAY[7,8,6,9,10,13,9])[n+1]
FROM week_base, generate_series(0,6) AS n
ON CONFLICT (week_start, day_of_week) DO NOTHING;

-- ── スタッフランキング ────────────────────────────────────────────
INSERT INTO staff_daily_rankings
  (date, staff_id, staff_name, today_sales, next_reserve_count, ai_adopt_rate, rank)
VALUES
  (CURRENT_DATE, 'kameyama', '亀山 純香', 52000, 4, 92.0, 1),
  (CURRENT_DATE, 'todate',   '外舘 裕子', 44000, 3, 87.0, 2),
  (CURRENT_DATE, 'admin',    '中村 さな', 32000, 2, 74.0, 3)
ON CONFLICT (date, staff_id) DO NOTHING;

-- ── KPI インサイト ────────────────────────────────────────────────
INSERT INTO kpi_insights (type, message, action) VALUES
  ('warning', '次回予約率が昨日より9ポイント低下しています。施術終了時の提案タイミングを確認してください。', '提案テンプレートを見る'),
  ('tip',     '施術終了15分前の次回提案の成功率が87%と最も高い傾向があります。',                         'ベストプラクティスを確認'),
  ('praise',  'LINE返信率が先月比+3ポイント。お客様との関係構築が順調です！',                             NULL)
ON CONFLICT DO NOTHING;
