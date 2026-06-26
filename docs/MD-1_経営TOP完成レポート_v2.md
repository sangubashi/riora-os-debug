# MD-1 経営TOP完成 完成レポート(設定UI・自動実行・実機検証)

作成日: 2026-06-25
対象設計書: `Riora_Management_Dashboard_Architecture_v2.0.md` / `v2.1.md` / `Riora_損益分岐・コスト構造_設計書_v1.0.md`
前提: 既存の調査レポート(MD-1経営TOP設計差分調査)で判明した「固定費入力UIが無い」「nightly自動実行が未設定」を解消するタスク。

## 実装範囲

| # | 実装対象 | 状態 |
|---|---|---|
| 1 | 固定費設定UI | 完成 |
| 2 | variable_rates設定UI | 完成 |
| 3 | brain_business_settings保存API | 完成 |
| 4 | DashboardAggregator自動実行(cron) | 完成 |
| 5 | 利益予測カード | 既存カードが実データで動作することを実機検証で確認 |
| 6 | 損益分岐カード | 同上 |
| 7 | 着地予測カード | 同上 |

## 1. 固定費設定UI / 2. variable_rates設定UI

`src/components/admin/dashboard/BusinessSettingsForm.tsx`(新規)を`/admin/business-settings`に実装。

- **固定費の内訳**: `Riora_損益分岐・コスト構造_設計書_v1.0.md §4`記載の14項目(役員報酬・固定給・交通費・家賃・広告費・freee月割・社保概算/実額・水道光熱費・通信費・消耗品)を個別入力できるフォーム。未入力はnullとして保存(損益分岐点・利益予測の計算対象から除外される既存仕様どおり)
- **変動費率(計算に使用する値)**: `variable_cost_rate`(0〜1の単一値)。DashboardAggregatorの計算式が実際に使用するのはこの値のみ
- **変動費率の内訳(記録用)**: `variable_rates`(incentive_rate/nomination_back/social_insurance_rate/square_rate/cashless_ratio/retail_cost_rate)の6項目。**記録用であり計算式へは反映されない**ことをUI上に明記(誤解防止。`variable_cost_rate`との関係を§6で詳述)
- サイドバーに「設定」項目を追加(`AdminSidebar.tsx`・v2.1設計書のサイドバー構成に準拠)
- 経営TOP(`DashboardHomeScreen.tsx`)に「固定費を設定する」リンクを追加。**`fixedCostsConfigured=false`の場合のみ表示**(既存のStat/レイアウトには一切変更を加えていない・追加のみ)

## 2. brain_business_settings保存API

`POST /api/admin/business-settings`(新規)・`GET /api/admin/business-settings`(新規)。

- `IBusinessSettingsRepo.upsert()`を新規追加(`(store_id, month)`でUPSERT)。指定したフィールドのみSETし、未指定フィールドは既存値/DB既定値を維持する(既存の`upsertDaily`と同じ設計パターンを継承)
- 入力検証: `app/api/_schemas/businessSettings.ts`(zod)。`variableCostRate`はDB CHECK制約(`0<=x<1`)に合わせて`0〜0.999999`に制限
- **計算式は一切実行しない**(保存のみ。損益分岐点・利益予測の計算は引き続き`DashboardAggregator.ts`が担当・本タスクで計算式に変更は加えていない)

## 3. DashboardAggregator自動実行(cron)

- `app/api/cron/dashboard-aggregator/route.ts`(新規): `runDashboardAggregator()`(既存・無変更)を呼ぶだけの薄いルート
- `vercel.json`に`crons`を追加: `0 15 * * *`(UTC)= 毎日00:00 JST実行
- 認証: `CRON_SECRET`環境変数が設定されている場合、Vercelが自動付与する`Authorization: Bearer`ヘッダを検証(未設定環境=ローカル開発では検証をスキップ)
- 対象店舗: 現状`DEMO_STORE_ID`固定(v2.0方針「2店舗目が決まった月に初出」を継承。既存の他nightlyスクリプトと同じ運用)

**残課題**: 本番Vercelプロジェクトへの`CRON_SECRET`環境変数の設定、および本デプロイの反映はユーザー側の操作が必要(次回デプロイから有効化される)。

## 4. 利益予測・5. 損益分岐・6. 着地予測カード

既存の`DashboardHomeScreen.tsx`「今月の経営(必須4指標)」カード(利益(暫定)/損益分岐まで/着地予測)は変更していない(計算式・表示ロジックとも無変更)。今回の固定費設定UIにより**初めて実データで動作することを実機検証で確認した**(§5)。

## 5. 実機検証(本番DB・読み書きあり)

ユーザー承認のもと、損益分岐設計書記載の実数値を本番`brain_business_settings`(store_id固定・month=2026-06-01)へ保存した(`scripts/md1_apply_real_business_settings.ts`):

```
固定費合計: ¥1,715,446(役員報酬900,000+外注50,000+固定給470,000+交通費42,800+家賃437,646+広告55,000+freee10,000+社保概算150,000)
変動費率: 0.075(7.5%)
```

`scripts/run_dashboard_aggregator.ts 2026-06-25`を実行し、`brain_dashboard_daily`へ当日分を生成:

```json
{
  "monthlySales": 801760,
  "forecastSales": 962112,
  "breakevenPoint": 1854536,
  "monthProfitEst": -825492,
  "visitCount": 39,
  "nominationRate": 0.3846...
}
```

`breakevenPoint=¥1,854,536`は損益分岐設計書§3の計算例(`¥1,715,446 ÷ 0.925 ≈ ¥1,854,536`)と**完全一致**(計算式が無変更であることの直接的な証拠)。

`GET /api/dashboard/top`で`fixedCostsConfigured: true`・`profit: -825492`・`breakevenRemaining: 1052776`・`forecastSales: 962112`を確認。

### スクリーンショット

- `docs/screenshots/MD-1_business_settings_form.png` — 設定画面(保存済みの実数値が表示されている)
- `docs/screenshots/MD-1_dashboard_real_business_settings.png` — 経営TOP(利益(暫定)¥-825K/損益分岐まで¥1,053K/着地予測¥962K が実データで表示。他の既存KPI(来店人数39人・指名率38%・CSV取込状況等)も変化なく表示されていることを確認)

Playwrightでブラウザを実際に開いて確認(コンソールエラー無し)。`cron`ルートもローカルサーバーで直接呼び出し、同一の集計結果が返ることを確認済み。

## 6. 設計上の補足: variable_cost_rate と variable_rates の関係

`Riora_損益分岐・コスト構造_設計書_v1.0.md §4`は将来的に`variable_rates`(内訳)から実効変動費率(`variable_rate_effective`)を動的算出する「精密版(Phase2)」を想定しているが、**現行の`DashboardAggregator.ts`はこの動的算出を実装していない**(単一値`variable_cost_rate`を直接使用)。本タスクは「計算式変更禁止」の制約に従い、この動的算出ロジックを新規実装することはせず、`variable_rates`は記録用の内訳入力として保存するのみに留めた。動的算出を実装する場合は別タスクとして計算式変更の承認を得ること。

## 7. 実装ファイル

| ファイル | 内容 |
|---|---|
| `src/repositories/interfaces.ts` | `BusinessSettingsUpsertInput`型・`IBusinessSettingsRepo.upsert()`追加 |
| `src/repositories/supabase/BusinessSettingsRepo.ts` | `upsert()`実装 |
| `src/repositories/supabase/mappers.ts` | `fromBusinessSettingsUpsert()`追加 |
| `app/api/_schemas/businessSettings.ts`(新規) | 入力検証スキーマ |
| `app/api/admin/business-settings/route.ts`(新規) | GET/POST |
| `app/api/cron/dashboard-aggregator/route.ts`(新規) | cron実行エンドポイント |
| `vercel.json` | `crons`追加 |
| `src/store/useBusinessSettingsStore.ts`(新規) | 設定画面の状態管理 |
| `src/components/admin/dashboard/BusinessSettingsForm.tsx`(新規) | 設定フォーム |
| `app/admin/business-settings/page.tsx`(新規) | ページラッパー |
| `src/components/admin/AdminSidebar.tsx` | 「設定」ナビ項目追加 |
| `src/components/admin/dashboard/DashboardHomeScreen.tsx` | 固定費未設定時のみ表示する設定リンクを追加(既存カードは無変更) |
| `scripts/md1_apply_real_business_settings.ts`(新規) | 実機検証用(損益分岐設計書の実数を保存) |

## 8. テスト結果

`npm test`(vitest): **55 files / 521 tests 全成功**(直前453+18+20=491件 + 本タスクで30件追加)。`npx tsc --noEmit`・`npm run build`ともにエラーなし。

新規テスト(30件):
- `tests/repositories/supabase/BusinessSettingsRepo.test.ts`(3件追加): `upsert`のフィルタ/部分更新/エラー処理
- `tests/api/business-settings.test.ts`(新規10件): GET/POST双方の検証・バリデーション・エラー処理
- `tests/api/cron-dashboard-aggregator.test.ts`(新規6件): `CRON_SECRET`認証(未設定/不一致/一致)・正常実行・エラー処理

## 9. 禁止事項の遵守

- **計算式変更禁止**: `DashboardAggregator.ts`は本タスクで一切編集していない(読み取りのみ)。実機検証で得た`breakevenPoint`が設計書の計算例と一致したことが、計算式が変更されていない直接的な証拠
- **既存KPI破壊禁止**: `DashboardHomeScreen.tsx`の既存カード・Stat値・レイアウトは変更していない(設定リンクの追加のみ、かつ条件付き表示で既存表示を阻害しない)。実機検証スクリーンショットで他の既存KPI(来店人数・指名率・CSV取込状況等)が変化なく表示されていることを確認済み
