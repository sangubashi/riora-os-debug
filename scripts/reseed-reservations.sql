-- ================================================================
--  reservations 再シード
--  public.customers に実在する id を使って予約データを正しく挿入
--
--  ・旧データは削除しない（orphaned になるだけで無害）
--  ・NOT EXISTS で同一顧客への二重挿入を防止
--  ・status 条件なし（get_customer_stats が全件集計するため）
--  ・scheduled_at を使用（INSERT で実績あり）
--  ・price カラムあり（ALTER TABLE 済み前提）
-- ================================================================

-- ── STEP 0: 現状確認 ─────────────────────────────────────────────
SELECT
  '既存 reservations' AS label,
  COUNT(*)            AS 総件数,
  COUNT(DISTINCT customer_id) AS distinct_customer_id,
  COUNT(*) FILTER (
    WHERE customer_id IN (SELECT id FROM public.customers)
  ) AS customers_に存在するID
FROM public.reservations;

-- ── STEP 1: 正しい customer_id で予約データを挿入 ────────────────
INSERT INTO public.reservations
  (customer_id, staff_id, menu, price, scheduled_at,
   duration_minutes, status,
   customer_name, is_vip, churn_risk, customer_type)

SELECT
  c.id,

  -- staff_id（TEXT 型対応）
  'ae68433d-69ce-4dc3-a38e-cc2501895fee',

  -- メニュー（顧客ID + 予約番号のハッシュで6種類）
  (ARRAY[
    'プレミアムエイジングケア',
    'モイスチャーフェイシャル',
    'ポアクリーニング + 美白ケア',
    'リラクゼーションコース',
    'ベーシックフェイシャル',
    'ハイドラフェイシャル'
  ])[ (abs(hashtext(c.id::text || gs.n::text)) % 6) + 1 ],

  -- 価格（顧客タイプ別の単価帯）
  CASE c.customer_type
    WHEN 'VIP型'       THEN 15000 + (abs(hashtext(c.id::text || 'p' || gs.n::text)) % 15001)
    WHEN '効果重視型'   THEN 12000 + (abs(hashtext(c.id::text || 'p' || gs.n::text)) %  8001)
    WHEN '感情重視型'   THEN 10000 + (abs(hashtext(c.id::text || 'p' || gs.n::text)) %  8001)
    WHEN '慎重・不安型' THEN  8000 + (abs(hashtext(c.id::text || 'p' || gs.n::text)) %  6001)
    ELSE                      9000 + (abs(hashtext(c.id::text || 'p' || gs.n::text)) %  7001)
  END,

  -- 来店日（n=1 が最近、数字が大きいほど過去）
  now() - (
    (gs.n * 38 + (abs(hashtext(c.id::text || 'd' || gs.n::text)) % 15))
    * INTERVAL '1 day'
  ),

  -- 施術時間（60 / 75 / 90 / 120 分）
  (ARRAY[60, 75, 90, 120])[
    (abs(hashtext(c.id::text || 'dur' || gs.n::text)) % 4) + 1
  ],

  -- ステータス
  'completed',

  -- customer_name（customers テーブルから取得）
  c.name,

  -- is_vip
  c.is_vip,

  -- churn_risk
  c.churn_risk_score,

  -- customer_type
  c.customer_type

FROM (
  SELECT
    id,
    name,
    customer_type,
    is_vip,
    churn_risk_score,
    (2 + (abs(hashtext(id::text)) % 4)) AS max_n
  FROM public.customers
) c
CROSS JOIN LATERAL
  generate_series(1, c.max_n) AS gs(n)

-- 同じ顧客に正しい customer_id の予約がまだなければ挿入
WHERE NOT EXISTS (
  SELECT 1
  FROM public.reservations r
  WHERE r.customer_id = c.id
);


-- ── STEP 2: 確認クエリ ────────────────────────────────────────────
SELECT
  '挿入後 reservations' AS label,
  COUNT(*) AS 総件数,
  COUNT(DISTINCT customer_id) AS distinct_customer_id,
  COUNT(*) FILTER (
    WHERE customer_id IN (SELECT id FROM public.customers)
  ) AS customers_IDと一致
FROM public.reservations;

-- 顧客ごとの集計サンプル（上位10名）
SELECT
  c.name,
  c.customer_type,
  COUNT(r.id)              AS 予約件数,
  COALESCE(SUM(r.price),0) AS 累計売上
FROM public.customers c
LEFT JOIN public.reservations r ON r.customer_id = c.id
GROUP BY c.id, c.name, c.customer_type
ORDER BY 累計売上 DESC
LIMIT 10;
