-- ================================================================
-- 2026-06-20: DB差分(W19 + brain_staff.name_aliases + brain_visits.source)
--
-- 設計根拠:
--   - README.md「実装着手の前提(順番厳守)」§1
--   - docs/architecture/Riora_Management_Dashboard_Architecture_v2.0.md
--     「DB差分(Master Schema v2.0 = W19)」
--   - docs/architecture/Riora_Management_Dashboard_Architecture_v2.1.md
--     「DB差分(Master Schema 次版)」brain_staff.name_aliases /
--     brain_visits.source CHECK拡張
--   - docs/architecture/Riora_損益分岐_コスト構造_設計書_v1.0.md
--     fixed_costs JSONB / variable_rates JSONB の内訳定義
--
-- 制約: 新規業務テーブルの追加は禁止。本ファイルは既存テーブル
--       (brain_business_settings / brain_dashboard_daily / brain_staff /
--        brain_visits)へのALTER TABLEのみで構成する。
--
-- 注意(実テーブル名は設計書と異なる): Master Schemaは business_settings /
-- dashboard_daily と表記するが、実DBは brain_ 接頭辞で統一されており
-- brain_business_settings / brain_dashboard_daily が正。本ファイルは
-- 実テーブル名に合わせる。
--
-- 適用状態: 未適用(このファイルはレビュー用。承認後に別途適用する)
-- ================================================================

-- ---------------------------------------------------------------
-- 1. brain_business_settings(W19)
-- ---------------------------------------------------------------

-- 1-1. seat_capacity: 曜日×時間帯別の席数(画面⑤稼働率の分母)
ALTER TABLE public.brain_business_settings
  ADD COLUMN IF NOT EXISTS seat_capacity jsonb;

COMMENT ON COLUMN public.brain_business_settings.seat_capacity IS
  '曜日×時間帯別の席数。例: {"mon": {"10": 2, "14": 3}, ...}。NULLの場合、稼働率(occupancy)はnull出力。';

-- 1-2. variable_rates: 変動費率の内訳(損益分岐設計書 §fixed_costs/variable_rates)
ALTER TABLE public.brain_business_settings
  ADD COLUMN IF NOT EXISTS variable_rates jsonb;

COMMENT ON COLUMN public.brain_business_settings.variable_rates IS
  '変動費率の内訳。例: {"incentive_rate": 0.05, "nomination_back": 250, '
  '"social_insurance_rate": 0.155, "square_rate": 0.025, "cashless_ratio": null, '
  '"retail_cost_rate": null}。既存の variable_cost_rate(単一値)は集計済み合算として維持し、本列は内訳の保持用。';

-- 1-3. fixed_costs: integer(単一値)→ jsonb(内訳)への型変更
--      現状アプリコード(DashboardRepo.ts等)はfixed_costsを直接参照していないため
--      コード側の影響はゼロ。既存値(現状は全店NULL)は legacy_total キーで保持する。
--      冪等化: 列が現在も integer のときのみ型変更を実行する。SQL Editorで
--      本ファイルを2回目以降に再実行した場合、列は既に jsonb になっているため
--      このブロックは何もしない。ガードなしで再実行すると
--      jsonb_build_object('legacy_total', fixed_costs) の fixed_costs が
--      既にjsonb値を指すため {"legacy_total": {"legacy_total": N}} のように
--      二重ラップされてしまう問題を防ぐ。
DO $$
BEGIN
  IF (
    SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'brain_business_settings'
      AND column_name = 'fixed_costs'
  ) = 'integer' THEN
    ALTER TABLE public.brain_business_settings
      ALTER COLUMN fixed_costs TYPE jsonb
      USING (
        CASE WHEN fixed_costs IS NULL THEN NULL
             ELSE jsonb_build_object('legacy_total', fixed_costs)
        END
      );
  END IF;
END $$;

COMMENT ON COLUMN public.brain_business_settings.fixed_costs IS
  '固定費の内訳JSONB。例: {"officer_suzuki": 450000, "officer_kishi": 50000, '
  '"outsource_kubota": 50000, "salary_kameyama": 250000, "salary_todate": 220000, '
  '"commute": 42800, "rent": 437646, "ad_hotpepper": 55000, "freee_monthly": 10000, '
  '"social_insurance_estimate": 150000, "social_insurance_actual": null, '
  '"utilities": null, "telecom": null, "supplies": null}。'
  'NULLの場合、nightly-dashboardはbreakeven_pointをNULLのまま出力する(未入力)。';

-- 既存の variable_cost_rate(numeric, CHECK 0<=x<1)は20260612000001_core_tables.sqlで
-- 既に追加済みのため、本ファイルでは変更しない。

-- ---------------------------------------------------------------
-- 2. brain_dashboard_daily(W19・経営TOP/離脱予兆/顧客資産/スタッフ分析/稼働率向け集計列)
-- ---------------------------------------------------------------
-- rebooking_rate は20260615_multi_store_prep.sql時点で既に存在するため対象外。

ALTER TABLE public.brain_dashboard_daily
  ADD COLUMN IF NOT EXISTS dm_to_booking_rate numeric,
  ADD COLUMN IF NOT EXISTS repeat_30 numeric,
  ADD COLUMN IF NOT EXISTS repeat_60 numeric,
  ADD COLUMN IF NOT EXISTS repeat_90 numeric,
  ADD COLUMN IF NOT EXISTS new_ratio numeric,
  ADD COLUMN IF NOT EXISTS nomination_rate numeric,
  ADD COLUMN IF NOT EXISTS month_profit_est integer,
  ADD COLUMN IF NOT EXISTS vip_customer_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS relation_triggers jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS occupancy jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.brain_dashboard_daily.dm_to_booking_rate IS
  'DM経由の予約転換率(画面②離脱予兆センター)。';
COMMENT ON COLUMN public.brain_dashboard_daily.repeat_30 IS '30日リピート率。';
COMMENT ON COLUMN public.brain_dashboard_daily.repeat_60 IS '60日リピート率。';
COMMENT ON COLUMN public.brain_dashboard_daily.repeat_90 IS
  '90日リピート率。既存の repeat_rate_90d とは別列(v2.0仕様の新規列名に合わせる)。'
  '将来的に repeat_rate_90d との統合可否はAPI実装時に再検討。';
COMMENT ON COLUMN public.brain_dashboard_daily.new_ratio IS '新規客比率(画面③顧客資産)。';
COMMENT ON COLUMN public.brain_dashboard_daily.nomination_rate IS
  '店舗全体の指名率(スタッフ個別の指名率はdashboard_cache側で保持・本列は店舗集計のみ)。';
COMMENT ON COLUMN public.brain_dashboard_daily.month_profit_est IS
  '月次着地利益予測(損益分岐設計書の計算式準拠)。fixed_costs未設定の月はNULL。';
COMMENT ON COLUMN public.brain_dashboard_daily.vip_customer_ids IS
  'VIP判定された顧客IDの配列。例: ["uuid1","uuid2"]。';
COMMENT ON COLUMN public.brain_dashboard_daily.relation_triggers IS
  '関係性トリガーの当日該当顧客。例: {"birthday": ["uuid1"], "anniversary": [], "dormant": ["uuid2"]}。';
COMMENT ON COLUMN public.brain_dashboard_daily.occupancy IS
  '曜日×時間帯×スタッフの稼働率。business_settings.seat_capacityが未設定の場合はNULL相当(空オブジェクト)。';

-- ---------------------------------------------------------------
-- 3. brain_staff.name_aliases(CSV名寄せ用・新規業務テーブルは作らない)
-- ---------------------------------------------------------------

ALTER TABLE public.brain_staff
  ADD COLUMN IF NOT EXISTS name_aliases jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.brain_staff.name_aliases IS
  'SalonBoard CSV取込時の担当者名表記ゆれ辞書。文字列配列。例: ["カメヤマ","亀山"]。'
  '一度紐付けたら次回以降は本列との一致で自動解決(Management Dashboard v2.1)。'
  '別テーブル案(staff_name_aliases)は本改版で不採用(新規業務テーブル禁止のため)。';

-- 店舗あたりスタッフ数が少数(数名〜十数名)のため、別途インデックスは設けない。
-- CSV側の検索は store_id でスコープした上でname_aliases @> 形式の包含チェックを想定。

-- ---------------------------------------------------------------
-- 4. brain_visits.source(B案ハイブリッド突合用)
-- ---------------------------------------------------------------

ALTER TABLE public.brain_visits
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'staff_input'
    CHECK (source IN ('staff_input', 'salonboard_import', 'reconciled'));

COMMENT ON COLUMN public.brain_visits.source IS
  '来店データの出自。staff_input=施術後30秒入力 / salonboard_import=CSV取込のみ '
  '(スタッフ入力なし・Brain学習の母集団から除外) / reconciled=staff_input行をCSVが'
  '突合・上書きした行(Brain学習対象・最良の教師データ)。既存行は履歴上すべてスタッフ'
  '入力由来のため DEFAULT ''staff_input'' でバックフィルする。';

-- 突合検索は (customer_id, visit_date) で行うため、既存の
-- idx_brain_visits_customer_date を再利用する。source列単体のインデックスは
-- 店舗単位のデータ規模(数千行程度)では不要と判断し、本ファイルでは追加しない。
