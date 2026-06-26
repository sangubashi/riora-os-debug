# AI経営アラート実装(MD-1最終仕上げ) 完成レポート

作成日: 2026-06-25
対象設計書: `Riora_Management_Dashboard_Architecture_v2.0.md` / `v2.1.md`(「今日の一手(AI Warning)」仕様)

## 背景

`brain_dashboard_daily.ai_insights`はDB列・API(`GET /api/dashboard/top`の`todayActions`)・UI(「今日の一手」カード)まで配線済みだったが、**生成ロジックが存在せず常に空配列**だった(`DashboardAggregator.ts`のコード冒頭コメントに「ai_insights等の決定論ルール生成は本Aggregatorのスコープ外・別タスク」と明記されており、本タスクがそれを実装するもの)。

## 1. AI Warning Engine(新規)

`src/lib/dashboard/AIWarningEngine.ts` — `computeAIWarnings()`(純粋関数・DB非依存・決定論ルール・**LLM不使用**)。

- 「失客予兆」は既存`ChurnRiskEngine`(MD-2)をそのまま再利用し、ロジックを分岐させていない
- 「VIP来店停滞」は既存`CustomerAssetEngine`(MD-3)のLTV算出をそのまま再利用
- **`DashboardAggregator.computeDashboardAggregate()`(月売上/着地予測/損益分岐/利益予測/来店人数/リピート率/指名率の既存計算式)は一切変更していない**(オーケストレーション層`runDashboardAggregator()`で結果を合成するだけ)

## 2. 決定論ルール(優先順位どおり8種類・LLM不使用)

| # | ルール | 実データソース | 発火条件 |
|---|---|---|---|
| 1 | 失客予兆 | `brain_customers`/`brain_visits`/`brain_staff`(ChurnRiskEngine再利用) | 来店周期1.5倍以上超過 |
| 2 | VIP来店停滞 | 上記+`brain_subscriptions`(CustomerAssetEngineのLTV再利用) | LTV上位20%の顧客が来店周期1.0倍以上超過 |
| 3 | DM反応率低下 | **実データソース無し** | **常にnull(後述§3)** |
| 4 | リピート率低下 | `brain_dashboard_daily.repeat_30`(今月・既存計算式)+前月の最終スナップショット | 前月比10%以上の低下 |
| 5 | 指名率低下 | `brain_dashboard_daily.nomination_rate`(同上) | 同上 |
| 6 | 来店周期超過 | `brain_visits` | 来店周期1.0〜1.5倍(失客予兆より早期の段階) |
| 7 | 高単価顧客離脱予兆 | `brain_visits`(客単価) | 客単価上位20%の顧客が来店周期1.0倍以上超過 |
| 8 | サブスク更新接近 | `brain_subscriptions`(continuing・`started_at`の日を毎月の請求日とみなす) | 請求日が7日以内 |

各ルールは該当する実データが無い場合**null**を返し、その日は警告を生成しない(モックデータ・固定文言で埋めることは一切していない)。

## 3. DM反応率低下が実装できない理由(誠実な開示)

`brain_line_send_queue`には`status`(pending/approved/sent/rejected)のみが記録され、**送信後の顧客反応(開封/予約への転換)を記録する列が存在しない**。`brain_dashboard_daily.dm_to_booking_rate`もnightlyで生成されていない(既存のMD-1調査レポートで既知の欠落)。実データが存在しない指標をモックで埋めることは禁止のため、本ルールは`ruleDmResponseRateDecline()`として関数自体は実装したが、**恒久的にnullを返す**(コード中に理由を明記)。将来DM反応の実データ(開封/予約転換のトラッキング)が整備された時点で実装する。

## 4. 出力形式

```ts
interface AIInsight {
  title: string
  message: string
  severity: 'critical' | 'warning' | 'info'
  targetCount: number
  actionType: 'contact_customer' | 'send_line' | 'review_staff' | 'upsell_campaign'
}
```

`src/types/riora.types.ts`に追加(既存`DashboardSnapshot.aiInsights: unknown[]`は読み取り側の後方互換のためそのまま維持し、書込側(`DashboardDailyUpsertInput.aiInsights?: AIInsight[]`・省略可能)でのみ型を使用)。

## 5. DashboardAggregator連携

`runDashboardAggregator()`が`customerRepo`/`staffRepo`/`subscriptionRepo`/`dashboardRepo.listSinceDate()`(前月最終スナップショット取得用)を追加で取得し、`computeAIWarnings()`の結果を`{ ...result, aiInsights }`として既存の集計結果に合成してから`upsertDaily()`へ渡す。`ai_insights`列は`aiInsights`が指定された場合のみSETされる(未指定時は既存値を保持・他のW19列と同じ方針)。

## 6. UI連携

`src/components/admin/dashboard/DashboardHomeScreen.tsx`「今日の一手」カードを、severity別の色分け(critical=赤/warning=ピンク/info=青)・対象件数・アクションラベル(顧客へ連絡/LINE案内/スタッフと確認/アップセル提案)を表示する形に更新した。既存の他カード(必須4指標/KPI4/来店・リピート・指名/CSV取込状況/売上推移)は無変更。

## 7. 実機検証

### 7.1 本番データでの実行結果

`scripts/run_dashboard_aggregator.ts 2026-06-25`を本番に対して実行:

```json
{ "monthlySales": 801760, "breakevenPoint": 1854536, "monthProfitEst": -825492, "visitCount": 39, "aiInsights": [] }
```

`aiInsights`が**空配列**になった。調査の結果、本番`brain_customers`(40件・`brain_visits`39件)は**全顧客が来店1回のみ**(複数来店の顧客が0件)・`brain_subscriptions`も0件であることを確認した。来店周期・LTV・客単価に基づく判定はいずれも「来店2回以上」を前提とするため、現状の実データでは**正しく何も発火しない**(モックで埋めないという設計方針どおりの挙動であり、バグではない)。

この「全顧客が来店1回のみ」という事実は、Pass D(CSV Import完成)で発見した「会員番号が無いCSVで同一人物が複数回来店すると別人として複数顧客レコードに分裂する」問題と整合する(分裂の結果、1人あたりの来店回数が1件に薄まっている)。

スクリーンショット: `docs/screenshots/MD-1_ai_warning_production_empty_state.png`(本番の正しい空状態。他カードに影響が無いことを確認済み)

### 7.2 ロジック動作確認(ローカル・本番DB非接触)

`scripts/ai_warning_engine_demo.ts`(本番へは一切書き込まない)で、複数来店を含む実データ形式のサンプルを与えて動作を確認した:

```
[critical] 失客予兆 (対象1件・contact_customer)
  田中花子様など1名が来店周期を大きく超過しています(危険度100%)。外舘から状況確認のご連絡をお願いします。

[warning] リピート率低下 (対象5件・review_staff)
  今月のリピート率(30日)が前月比50%低下しています(60%→30%)。

[warning] 指名率低下 (対象5件・review_staff)
  今月の指名率が前月比60%低下しています(50%→20%)。

[critical] 高単価顧客離脱予兆 (対象1件・contact_customer)
  客単価上位20%の田中花子様など1名に来店間隔の乱れが見られます。

[info] サブスク更新接近 (対象1件・upsell_campaign)
  鈴木理恵様など1名のサブスク更新が3日後に迫っています。
```

5種類のルールが意図どおりの優先順位・文言で発火することを確認した。

## 8. テスト結果

`npm test`(vitest): **56 files / 537 tests 全成功**(直前521件 + 本タスクで16件追加)。`npx tsc --noEmit`・`npm run build`ともにエラーなし。

新規テスト(16件):
- `tests/lib/dashboard/AIWarningEngine.test.ts`(12件): 8ルール全種の発火/非発火条件・優先順位順序・データ無し時の空配列
- `tests/lib/dashboard/DashboardAggregator.test.ts`(2件追加): repos拡張(customer/staff/subscription/listSinceDate)・aiInsights合成・既存計算式が無変更であることの確認・前月スナップショットを使ったリピート率低下判定
- `tests/repositories/supabase/DashboardRepo.test.ts`(2件追加): `ai_insights`列の条件付きSET(指定時のみ・既存方針と同じ)

## 9. 実装ファイル

| ファイル | 内容 |
|---|---|
| `src/lib/dashboard/AIWarningEngine.ts`(新規) | エンジン本体(8ルール・決定論・LLM不使用) |
| `src/lib/dashboard/DashboardAggregator.ts` | `runDashboardAggregator()`を拡張(既存`computeDashboardAggregate()`は無変更) |
| `src/types/riora.types.ts` | `AIInsight`/`AIInsightSeverity`/`AIInsightActionType`追加 |
| `src/repositories/interfaces.ts` | `DashboardDailyUpsertInput.aiInsights?`追加(省略可能) |
| `src/repositories/supabase/mappers.ts` | `toBrainDashboardDailyUpsert()`に`ai_insights`の条件付き追加 |
| `src/store/useDashboardTopStore.ts` | `TodayAction`型を追加(`todayActions: unknown[]`→`TodayAction[]`) |
| `src/components/admin/dashboard/DashboardHomeScreen.tsx` | 「今日の一手」カードをseverity/targetCount/actionType表示に更新 |
| `scripts/run_dashboard_aggregator.ts` | customerRepo/staffRepo/subscriptionRepoを追加 |
| `scripts/ai_warning_engine_demo.ts`(新規) | ロジック動作確認用(本番DB非接触) |

## 10. 禁止事項の遵守

- **LLM利用禁止**: LLM/AI APIは一切呼んでいない(全ルールが決定論的な数値比較のみ)
- **モックデータ禁止**: 実データソースが無い「DM反応率低下」は恒久的にnullを返す実装とし、固定値・架空データで埋めていない。本番実行結果が空配列になったのも実データの事実であり、それをそのまま受け入れている
- **固定文言禁止**: メッセージは実データ(顧客名・件数・危険度・変化率・残日数)を埋め込んだテンプレートであり、文言自体に依存する分岐はない(実データが変わればメッセージも変わる)
- **既存Dashboard集計ロジック変更禁止**: `computeDashboardAggregate()`は1行も変更していない。実機検証で得た`monthlySales`/`breakevenPoint`等の値が既存仕様・既存テストと一致することを確認済み
