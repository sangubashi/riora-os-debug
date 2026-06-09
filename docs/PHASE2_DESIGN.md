# Riora OS — Phase 2 KPI画面 設計書

作成日: 2026-06-04
ステータス: 設計のみ（未実装）
前提: 現場代表 + スタッフ2名の小規模サロン

---

## 基本方針

スタッフランキング（比較）→ 改善提案（成長）に切り替える。
数字を見せるのではなく「次に何をすればいいか」を見せる。

---

## 画面構成（タブ4本）

```
/kpi
  ├─ [失客防止]   ← デフォルト表示
  ├─ [VIP化]
  ├─ [売上予測]
  └─ [改善分析]
```

---

## ① 失客防止ダッシュボード

### 目的
放置すると離脱する顧客を早期に把握して行動を促す。

### 画面構成

```
失客予備軍 サマリーカード
  来店間隔超過: ○名
  次回予約なし: ○名
  LINE未返信:   ○名（14日以上）
  ↓
失客予備軍一覧（churnRisk順）
  顧客名 / 危険度 / 理由タグ / 推奨アクション
  ↓
1タップアクション
  [LINE送信] [次回予約を提案] [メモを確認]
```

### 必要データ

| データ | 取得元 |
|---|---|
| churn_risk_score | customers テーブル |
| last_visit_date | customers テーブル |
| next_visit_date | customers テーブル |
| line_response_rate | customers テーブル（実値取得後） |
| recommended_cycle_days | customers テーブル |
| has_next_rebook | customer_visits テーブル（Phase2で追加） |

### 必要DB

- 既存テーブルで対応可能
- `customer_visits.has_next_rebook` カラムの活用
- `customers.line_last_sent_at`（LINE連携後に追加）

### 既存コードとの関係

- `ChurnRiskRanking.tsx` を拡張して流用可能
- `calcCustomerPhase()` の risk 判定ロジックをそのまま利用
- アクションボタンは `actionRules.ts` の phase_risk_line / phase_risk_call を流用

---

## ② VIP化ダッシュボード

### 目的
あと少しでVIPになれる顧客を特定して優先的にアプローチする。

### 画面構成

```
VIP候補サマリー
  VIP候補（類似度70%以上）: ○名
  今月VIP到達見込み: ○名
  ↓
VIP候補一覧（類似度順）
  顧客名 / VIP類似度 / 不足金額 / 不足来店回数
  ↓
各顧客の昇格シミュレーター
  最短ルート: あと○回来店 または あと¥○○○の利用
```

### 必要データ

| データ | 取得元 |
|---|---|
| visits / total_sales | customers テーブル |
| vip_rank | customers テーブル |
| VIP平均値 | calcVipAnalytics() で計算 |
| similarityScore | calcSimilarityToVip() で計算 |
| gaps | calcVipPromotion() で計算 |

### 必要DB

- 追加テーブル不要
- 既存の `calcSimilarityToVip()` `calcVipPromotion()` をそのまま利用
- useCustomerStore の customers を全件取得して計算

### 既存コードとの関係

- `VipSimilarityCard.tsx` の一覧版として実装
- `VipPromotionCard.tsx` の不足項目表示をそのまま流用
- `DEMO_ANALYTICS_CUSTOMERS` → 本番では useCustomerStore から取得

---

## ③ 売上予測ダッシュボード

### 目的
今月・来月の売上着地を予測して不足原因を可視化する。

### 画面構成

```
今月予測カード
  現在売上: ¥○○○
  着地予測: ¥○○○
  目標比:   ○%
  ↓
来月予測カード
  予約済み売上: ¥○○○
  VIP継続予測: ¥○○○
  新規見込み:   ¥○○○
  ↓
不足額と原因分析
  不足: ¥○○○
  原因: 次回予約率が低い / VIP来店頻度が落ちている / 等
  ↓
改善アクション提案（上位3件）
```

### 必要データ

| データ | 取得元 | 備考 |
|---|---|---|
| 今月の予約済み売上 | reservations テーブル | scheduled_at で集計 |
| 過去3ヶ月平均売上 | useKpiStore（既存） | monthlySales |
| VIP顧客の来店周期 | customers テーブル | recommended_cycle_days |
| 次回予約率 | useKpiStore（既存） | nextReserveRate |
| スタッフ稼働率 | reservations テーブル | 既存 OccupancyHeatmap から取得 |

### 必要DB

- 追加テーブル不要
- 既存の Supabase RPC `get_customer_stats` を拡張
- 月次売上履歴: `reservations` テーブルの `scheduled_at × price` で集計

### 予測ロジック（設計）

```
今月着地予測 =
  確定済み予約売上
  + （残稼働日 × 直近7日平均日次売上）

来月予測 =
  VIP顧客の来店周期から次回来店日を予測して積算
  + リピーター顧客の平均来店間隔から積算
  + 新規獲得見込み（過去3ヶ月平均）
```

---

## ④ スタッフ改善分析

### 目的
ランキングで比較するのではなく、各スタッフが何を伸ばすべきかを示す。

### 画面構成

```
スタッフ選択タブ
  [鈴木] [亀山] [外舘]
  ↓
強み・弱み・改善ポイント
  強み:   指名率 85% / ホームケア提案率 72%
  弱み:   次回予約率 61%（全体平均 74%より低い）
  改善:   施術終盤での次回提案タイミングを意識
  ↓
今月の行動ログ
  AI提案実施: ○回
  店販提案:   ○回
  LINE送信:   ○回
  ↓
先月比の改善トレンド
```

### 必要データ

| データ | 取得元 |
|---|---|
| スタッフ別売上・指名数 | reservations テーブル（staff_id で集計） |
| 行動ログ | customer_action_logs テーブル（staff_id で集計） |
| 次回予約率 | reservations テーブル |
| 店販実施率 | customer_action_logs の retail_sold で集計 |

### 必要DB

- `customer_action_logs.staff_id` カラムの追加（現在は customer_id のみ）
- `reservations` の `staff_id × price` 集計で対応可能

---

## 実装優先順位

### 優先度 高（失客防止に直結）

1. **失客防止ダッシュボード**
   - 既存の ChurnRiskRanking・actionRules を流用するため実装コスト低
   - useCustomerStore の実データが揃えばすぐ表示できる

2. **VIP化ダッシュボード**
   - calcSimilarityToVip / calcVipPromotion が完成済みのため流用可
   - 一覧化するだけで実装可能

### 優先度 中

3. **スタッフ改善分析**
   - customer_action_logs.staff_id の追加が必要
   - StaffRanking.tsx を改善提案型に書き換え

### 優先度 低（予測精度に外部データが必要）

4. **売上予測ダッシュボード**
   - 過去データが蓄積されないと精度が出ない
   - LINE返信率・来店周期の実値が揃ってから実装

---

## 既存コンポーネントの扱い

| コンポーネント | Phase2での扱い |
|---|---|
| StaffRanking.tsx | スタッフ改善分析に置き換え（ファイルは残す） |
| ChurnRiskRanking.tsx | 失客防止ダッシュボードに統合して拡張 |
| VipSimilarityCard.tsx | VIP化ダッシュボードで一覧版として流用 |
| VipPromotionCard.tsx | 同上 |
| CustomerAnalyticsPanel.tsx | 売上予測の参照データとして維持 |
| StoreLearningPanel.tsx | 改善提案の根拠データとして維持 |
| RepeatAnalytics.tsx | 売上予測に統合 |
| SalonBoardImportPanel.tsx | 現行維持（CSV取込は独立タブ推奨） |

---

## タブ構成の変更案

### 現在

スクロール1本（タブなし）

### Phase2

```
[失客防止] [VIP化] [売上予測] [改善分析]
```

実装方法: KpiDashboard.tsx にタブ state を追加して
各タブコンテンツをコンポーネントで分離する。

---

*本設計書は Riora OS の既存アーキテクチャ（calcCustomerPhase / calcSimilarityToVip / actionRules）への依存を最大化して実装コストを最小化する方針で設計しています。*
