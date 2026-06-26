# MD-1 経営TOPダッシュボード完成レポート

作成日: 2026-06-22

## 1. 実装範囲(v2.0画面①準拠)

設計根拠: `docs/architecture/Riora_Management_Dashboard_Architecture_v2.0.md` 画面①(v2.1は画面⑥CSV Import専用の差分のため新規API化はしない方針)。

実装順は指示通り Repository → API → Zustand Store → UI。

| コンポーネント | 内容 |
|---|---|
| 今月の経営(必須4指標) | 売上/利益(暫定)/損益分岐まで/着地予測。固定費未設定の月は利益=「設定待ち」表示 |
| KPI(4枠固定) | 本日売上/目標進捗/次回予約率/DM→予約転換率 |
| 今日の一手 | `ai_insights`(nightly-dashboard生成済み・決定論ルール・LLM不使用)をそのまま一行表示。グラフ・気づき列挙なし |
| CSV取込状況カード | `brain_ops_logs(kind='csv_import')`の最新1件から最終取込日時・新規/更新・来店取込件数・未解決スタッフ件数を表示 |
| 売上推移 | 当月の`brain_dashboard_daily`日次スナップショット(monthly_sales)を棒グラフで表示 |

**スタッフランキングはMD-1から除外**(ユーザー確認済み)。v2.0では画面④スタッフ分析(MD-4)の独立API契約として「売上単体表示禁止・順位/合計/平均比較なし」が明記されており、画面①の data sourceテーブルにもスタッフ関連項目は存在しないため。

## 2. 使用テーブル一覧

| テーブル | 用途 | 備考 |
|---|---|---|
| `brain_dashboard_daily` | 今月売上/利益予測/損益分岐点/着地予測/次回予約率/DM→予約転換率/今日の一手(ai_insights)/売上推移 | nightly-dashboardが生成。W19列(`dm_to_booking_rate`/`month_profit_est`等)を含めて読み取り専用 |
| `brain_business_settings` | 目標進捗算出用`sales_target`、利益算出ガード用`fixed_costs`有無判定 | 新規Repository(`BusinessSettingsRepo`)を追加 |
| `brain_visits` | 本日売上(当日visitsの`treatment_amount+retail_amount`軽量集計) | 既存`VisitRepo`に`sumSalesByStoreAndDate()`を追加 |
| `brain_ops_logs` | CSV取込状況カード(`kind='csv_import'`の最新1件) | 既存`IOpsLogRepo.recentByStoreAndKind()`をそのまま再利用(新規API化なし、v2.1§3方針通り) |

## 3. 実装ファイル

### Repository
- `src/repositories/supabase/DashboardRepo.ts` — `DASHBOARD_COLUMNS`にW19列を追加、`listSinceDate()`を新規追加(売上推移用)
- `src/repositories/supabase/BusinessSettingsRepo.ts` — 新規(`IBusinessSettingsRepo.findByStoreAndMonth()`)
- `src/repositories/supabase/VisitRepo.ts` — `sumSalesByStoreAndDate()`を新規追加
- `src/repositories/supabase/mappers.ts` — `BrainDashboardRow`/`toDashboardSnapshot()`にW19列追加、`BrainBusinessSettingsRow`/`toBusinessSettings()`新規追加
- `src/types/riora.types.ts` — `DashboardSnapshot`にW19フィールド追加、`BusinessSettings`をW19仕様(jsonb内訳)に統合(旧定義は未使用のため削除)
- `src/repositories/interfaces.ts` — `IDashboardRepo.listSinceDate()`/`IBusinessSettingsRepo`/`IVisitRepo.sumSalesByStoreAndDate()`を追加
- `app/lib/repos.ts` — `businessSettingsRepo`をRepository Factoryに追加

### API
- `app/api/dashboard/top/route.ts` — `GET /api/dashboard/top?storeId=&date=`(新規)。スタッフ関連フィールドは一切含めない
- `app/api/_schemas/query.ts` — `dashboardTopQuerySchema`追加

### Zustand Store
- `src/store/useDashboardTopStore.ts` — 新規。`/api/dashboard/top`をfetchするだけ(mock・Supabase直叩きなし)

### UI
- `src/components/admin/dashboard/DashboardHomeScreen.tsx` — 新規
- `app/admin/dashboard/page.tsx` — 新規(ページラッパー)

## 4. テスト結果

`npm test`: **30 files / 340 tests 全成功**(既存312件 + 本タスクで28件追加)
`npm run typecheck`: 本タスク関連ファイルはエラーなし。`e2e/prod-verify.spec.ts`・`e2e/voice-memo-verify.spec.ts`の既存2件(本タスクと無関係・git差分なし)のみ残存。

新規/更新テスト:
- `tests/repositories/supabase/DashboardRepo.test.ts`(`listSinceDate`分を追加)
- `tests/repositories/supabase/BusinessSettingsRepo.test.ts`(新規)
- `tests/repositories/supabase/VisitRepo.test.ts`(`sumSalesByStoreAndDate`分を追加)
- `tests/api/dashboard-top.test.ts`(新規・15件: 必須4指標/KPI4/固定費未設定/業績設定なし/今日の一手/売上推移/CSV取込状況/空状態/エラー系)
- `tests/api/dashboard.test.ts`・`tests/lib/import/csvImportPipeline.test.ts` — 型拡張に追従するフィクスチャ更新のみ

## 5. 実DB(dry-run同様の読み取り専用確認)

本番/Previewと共有するSupabaseプロジェクト(`ohszxgajckzphhfhdrsv.supabase.co`)に対し、**読み取り専用**で`GET /api/dashboard/top?storeId=00000000-0000-0000-0000-000000000001`を実行し動作確認(書込は一切なし)。

```json
{
  "success": true,
  "required4": { "monthlySales": 0, "profit": null, "breakevenPoint": null, "breakevenRemaining": null, "forecastSales": 0, "fixedCostsConfigured": false },
  "kpi4": { "todaySales": 0, "targetProgress": 0, "salesTarget": 2500000, "rebookingRate": null, "dmToBookingRate": null },
  "todayActions": [],
  "salesTrend": [],
  "csvImportStatus": null
}
```

`brain_business_settings`に`sales_target=2500000`が既に設定済み(`fixed_costs`は未設定)であることを確認。`brain_dashboard_daily`は現状0件のため、売上・KPI・今日の一手・売上推移はいずれもゼロ値/空配列で正しくグレースフルに応答することを確認(クラッシュ・404なし)。

## 6. 画面キャプチャ

`docs/screenshots/MD-1_dashboard_home_empty_state.png`

**注記**: `brain_dashboard_daily`が現状0件(nightly-dashboard未稼働のため)のため、上記は実データに基づく**ゼロ状態(空状態)**のキャプチャです。本番DBへの書込は標準作業の安全制約(ユーザー確認なしでの書込禁止)に従い行っていません。`brain_dashboard_daily`にデータが入った状態のキャプチャが必要な場合は、別途データ投入の許可をいただければ取得します。

## 7. 残課題

1. **`brain_dashboard_daily`が全店舗0件**: nightly-dashboard(DashboardAggregator拡張)が未稼働のため。本画面はこれを読むだけの設計であり、aggregator側の実装は本タスクのスコープ外。
2. **「Dry Runエラー」件数(CSV取込状況カード)**: v2.1のワイヤーフレーム例に記載があるが、dry-runは本来DBに何も書き込まない設計のため永続化先が存在しない。本実装では`brain_ops_logs`に実際に記録されている項目(最終取込日時/新規・更新/来店取込/未解決スタッフ件数)のみを表示し、Dry Runエラー件数は表示していない。
3. **マルチストア切替UI**: v2.0方針通り「2店舗目が決まった月に初出」のため、現状は`DEMO_STORE_ID`固定(CSV Import画面⑥と同じ運用)。
