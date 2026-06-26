# DashboardAggregator 完成レポート

作成日: 2026-06-23(2026-06-23 追記: visit_count migration適用完了・MD-1実データ表示確認完了)

## 1. 実装範囲

設計根拠: `docs/architecture/Riora_Management_Dashboard_Architecture_v2.0.md`「集計は全て nightly-dashboard(DashboardAggregator拡張)で生成→画面は読むだけ」。コード調査の結果、`DashboardAggregator`の実体はリポジトリ内に存在せず(ドキュメント上の構想のみ)、本タスクで新規実装した。

対象KPI(ユーザー指定8項目)の扱い:

| KPI | 実装方式 |
|---|---|
| 今日売上 | **対象外(意図的)**。v2.0設計どおり`GET /api/dashboard/top`が当日visitsを`VisitRepo.sumSalesByStoreAndDate()`でライブ集計する既存方式を維持。nightly集計にすると当日分が前日時点で止まり「今日」の意味を失うため |
| 月売上 | `monthly_sales`(MTD累計) |
| 利益予測 | `month_profit_est` |
| 損益分岐点 | `breakeven_point` |
| 売上推移 | 既存`listSinceDate()`が`monthly_sales`の日次スナップショットを返す仕組みをそのまま利用(本タスクで新規追加した列ではない) |
| 来店人数 | `visit_count`(新規列・MTD累計のユニーク顧客数) |
| リピート率 | `repeat_30`/`repeat_60`/`repeat_90`(既存W19列) |
| 指名率 | `nomination_rate`(既存W19列) |

`ai_insights`/`vip_customer_ids`/`relation_triggers`/`occupancy`/`segment_matrix`/`funnel`/`staff_matrix`/`rebooking_rate`/`dm_to_booking_rate`/`new_ratio`/`homecare_rate`/`repeat_rate_90d`は今回のスコープ外(指定8KPIに含まれないため未生成・既存値を保持)。

## 2. 計算ロジック(すべて決定論的コード・LLM/AI不使用)

`src/lib/dashboard/DashboardAggregator.ts`

| 列 | 計算式 | 根拠 |
|---|---|---|
| `monthly_sales` | 月初〜snapshot_dateの`treatment_amount+retail_amount`合計(MTD) | 既存`monthly_sales`の用途(月初来の累計スナップショット)に合わせた |
| `forecast_sales`(着地予測) | `monthly_sales ÷ 経過日数 × 当月日数`(ランレート射影) | v2.0「着地予測」の一般的な定義 |
| `breakeven_point` | `fixed_costsの数値リーフ合計 ÷ (1 − variable_cost_rate)` | W19 COMMENT ON COLUMN記載の式そのまま |
| `month_profit_est` | `forecast_sales × (1 − variable_cost_rate) − fixed_costs合計` | 列名・COMMENTが「月次**着地**利益予測」であるため、MTD実績でなく着地予測売上を基準に算出(**設計判断・要確認**: もしUI上の「利益(暫定)」がMTD実績ベースを期待しているなら別途調整が必要) |
| `visit_count`(来店**人数**) | 当月来店のユニーク顧客数(来店件数ではない) | 「人数」という名称から件数でなく人数と判断 |
| `repeat_30`/`60`/`90` | 当月来店のうち、直前来店(全履歴から検索・月をまたいでも可)からN日以内だった割合。初回来店(直前来店なし)は分母から除外 | アーキ文書に厳密な数式定義が無いため、本タスクで定義した実装上の決定(コードコメントに明記) |
| `nomination_rate` | 当月来店のうち`is_nomination=true`の割合 | 自明な定義 |

固定費は`brain_business_settings.fixed_costs`(jsonb内訳・null混在)の数値リーフのみ合算。`fixed_costs`が未設定(null)の月は`breakeven_point`/`month_profit_est`ともnull(「設定待ち」表示)。

## 3. 変更ファイル

### Repository層(新規メソッド)
- `src/repositories/interfaces.ts`: `IVisitRepo.listByStore()`、`IDashboardRepo.upsertDaily()`、`DashboardDailyUpsertInput`型を追加
- `src/repositories/supabase/VisitRepo.ts`: `listByStore()`実装(store_id+visit_date昇順・deleted_at除外)
- `src/repositories/supabase/DashboardRepo.ts`: `upsertDaily()`実装。`DASHBOARD_COLUMNS`に`visit_count`を追加
- `src/repositories/supabase/mappers.ts`: `toBrainDashboardDailyUpsert()`新規、`BrainDashboardRow`/`toDashboardSnapshot()`に`visit_count`追加
- `src/types/riora.types.ts`: `DashboardSnapshot.visitCount`追加

### Aggregator本体
- `src/lib/dashboard/DashboardAggregator.ts`(新規): `computeDashboardAggregate()`(純粋関数)・`runDashboardAggregator()`(repos経由のオーケストレーション)

### API(MD-1への反映)
- `app/api/dashboard/top/route.ts`: `extendedKpi`(visitCount/repeat30-90/nominationRate)を追加。既存`required4`/`kpi4`(KPI4枠固定の契約)は変更していない

### Migration
- `supabase/migrations/20260623_dashboard_aggregator_visit_count.sql`(新規): `brain_dashboard_daily.visit_count`列追加。**本番適用済み**(2026-06-23・SQL Editorで実行・再確認済み)

### UI(MD-1への表示反映)
- `src/store/useDashboardTopStore.ts`: `ExtendedKpi`型・`DashboardTopData.extendedKpi`を追加(APIレスポンスに存在したが型・ストアで未受領だった抜け漏れを修正)
- `src/components/admin/dashboard/DashboardHomeScreen.tsx`: 「来店・リピート・指名(月次)」セクションを新設し、来店人数/リピート率(30日・90日)/指名率を表示

## 4. テスト結果

`npm test`: **31 files / 358 tests 全成功**(既存341件 + 本タスクで17件追加)
`npm run typecheck`: 本タスク関連ファイルはエラーなし。既存無関係2件(`e2e/prod-verify.spec.ts`/`e2e/voice-memo-verify.spec.ts`)のみ残存。

新規/更新テスト:
- `tests/lib/dashboard/DashboardAggregator.test.ts`(新規11件): MTD集計/着地予測/0件月/fixed_costs null/fixed_costs内訳合算/visit_count(人数≠件数)/nomination_rate/repeat_30-90(月境界を跨ぐ前回来店探索含む)/runDashboardAggregatorのオーケストレーション
- `tests/repositories/supabase/VisitRepo.test.ts`・`DashboardRepo.test.ts`: `listByStore`/`upsertDaily`分を追加
- `tests/api/dashboard-top.test.ts`・`dashboard.test.ts`: `visitCount`/`extendedKpi`に追従するフィクスチャ更新

## 5. 本番DB生成確認(完了)

**migration適用の経緯**: 初回のSQL Editor実行では`visit_count`列が反映されず原因不明のまま停滞したが、再度同じSQLを実行したところ`Success. No rows returned`(ALTER TABLE/COMMENTの正常終了)で完了し、列の存在を確認できた(原因は特定できていないが、再実行で解消)。

`scripts/run_dashboard_aggregator.ts`(本番運用でも使う実行スクリプト・`runDashboardAggregator()`をそのまま呼ぶ)を本番Supabase(store_id=`00000000-0000-0000-0000-000000000001`、snapshot_date=`2026-06-23`)に対して実行:

```json
{
  "monthlySales": 801760,
  "forecastSales": 1045774,
  "breakevenPoint": null,
  "monthProfitEst": null,
  "visitCount": 39,
  "repeat30": null,
  "repeat60": null,
  "repeat90": null,
  "nominationRate": 0.38461538461538464
}
```

`brain_dashboard_daily`に`visit_count`含む全列が正しく書き込まれたことを再クエリで確認済み。

実データとの整合性確認:
- `nominationRate=15/39=0.3846…`は、前タスク(CSV Import実フォーマット対応)で確認した「実39件中15件が指名あり」と完全一致
- `breakevenPoint`/`monthProfitEst`がnullなのは、当店舗の`brain_business_settings.fixed_costs`が未設定(null)のため設計どおり
- `repeat_30/60/90`が全てnullなのは、当店舗の全39来店が現状すべて初回来店(直前来店を持つ顧客が0件)のため設計どおり

## 6. MD-1実データ表示確認(完了)

`GET /api/dashboard/top?storeId=00000000-0000-0000-0000-000000000001&date=2026-06-23`をローカルdevサーバーから実行し、200成功・`extendedKpi: {visitCount:39, repeat30:null, repeat60:null, repeat90:null, nominationRate:0.3846...}`が返ることを確認した。

調査の過程で、`extendedKpi`がAPIレスポンスに存在するにもかかわらず`useDashboardTopStore.ts`の型(`DashboardTopData`)と`DashboardHomeScreen.tsx`のどちらにも受け取り口が無く、**画面には一切表示されない状態**だったことが判明したため、本タスクで両方に実装を追加した(§3「UI」参照)。

Playwrightで`/admin/dashboard`を実際に開いて確認した結果、新設した「来店・リピート・指名(月次)」カードに**来店人数 39人 / 指名率 38%**が実データとして表示されることを確認した(リピート率は前述のとおり対象顧客が0件のため「—」表示・設計どおり)。

## 6b. スクリーンショット(完了)

`docs/screenshots/MD-1_dashboard_home_real_data.png`(実データ状態・`/admin/dashboard`フルページ)。`brain_dashboard_daily`が0件だった前回(`MD-1_dashboard_home_empty_state.png`・空状態)との対比として、今回は実データでの表示を確認できた。

## 7. 使用テーブル一覧

| テーブル | 用途 |
|---|---|
| `brain_visits` | 集計の主入力(treatment_amount/retail_amount/customer_id/visit_date/is_nomination)。`VisitRepo.listByStore()`で全履歴を1回取得 |
| `brain_business_settings` | `variable_cost_rate`/`fixed_costs`(損益分岐点・利益予測の入力) |
| `brain_dashboard_daily` | 書込先(`store_id, snapshot_date`でUPSERT)。新規列`visit_count`を追加(本番適用済み) |

新規業務テーブルの追加なし(既存方針を継承)。

## 8. 残課題

1. **nightly自動実行の未設定**: 本タスクは`DashboardAggregator`本体と手動/スクリプト実行(`scripts/run_dashboard_aggregator.ts`)のみ実装。Vercel Cron等への登録(`vercel.json`変更)は本番運用に影響するため、本タスクでは行っていない(別途確認の上で実施)
2. **`month_profit_est`の基準**: forecast_sales(着地予測)を基準に算出する設計のままユーザー承認済み(2026-06-23)
3. **複数店舗対応**: 現状は店舗を1件ずつ指定して実行する設計。店舗が増えた場合はnightly実行時に全店舗をループする呼び出し側(cron route等)が必要(Aggregator本体は1店舗ずつの呼び出しを前提に設計済みのため変更不要)
