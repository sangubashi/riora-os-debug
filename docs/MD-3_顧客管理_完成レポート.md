# MD-3 顧客管理 完成レポート

作成日: 2026-06-23

## 1. 実装範囲

設計根拠: `docs/architecture/Riora_Management_Dashboard_Architecture_v2.0.md` 画面③(顧客資産)。ユーザー指示(2026-06-23)により表示項目を以下に絞った(v2.0の「VIPランク」「関係性トリガー」「コホート再来率」「新規/既存比率」は今回スコープ外)。

| 表示項目 | 実装 |
|---|---|
| 顧客一覧 | `GET /api/admin/customer-assets`(LTV降順) |
| 来店回数 | `visitCount` |
| 最終来店日 | `lastVisitDate` |
| LTV | `ltv` = 累計売上 + 継続中サブスクのMRR×6(v2.0「LTV(累計売上+MRR×6)」準拠) |
| 累計売上 | `totalSales` |
| 指名状況 | `nominationRate`(全来店のうちis_nomination=trueの割合) |
| 来店間隔 | `avgIntervalDays`(個人の平均来店間隔・来店2回未満はnull) |

**管理者は閲覧のみ**: `GET`のみを実装し、顧客の編集・削除に相当するPOST/PATCH/DELETEは一切実装していない。

## 2. DB確認(実装着手前に調査)

- `brain_customers`/`brain_visits`はMD-1/MD-2で追加済みの`listByStore()`(Repository層)がそのまま使える
- LTV計算に必要な`brain_subscriptions`(`customer_id, monthly_price, started_at, cancelled_at`)は**テーブルは既存だが、リポジトリ層がコードベース上に一切存在しなかった**(`Subscription`型・スキーマ定義のみ存在し、読み書きするコードが無い未使用テーブルだった)。本タスクで新規に`ISubscriptionRepo`/`SubscriptionRepo.ts`を追加した(新規テーブル・migrationは不要・既存テーブルへの新規Repositoryクラス追加のみ)

## 3. 実装順序(指示通りDB→Repository→API→UIを厳守)

1. **DB確認**(§2)
2. **Repository**: `ISubscriptionRepo.listByStore()`を新規追加(`src/repositories/interfaces.ts`/`SubscriptionRepo.ts`/`mappers.ts`の`toSubscription()`)。`app/lib/repos.ts`に`subscriptionRepo`を追加。`customerRepo`/`visitRepo`の`listByStore()`は既存のまま再利用
3. **API**: `app/api/admin/customer-assets/route.ts`(GETのみ)。`app/api/_schemas/query.ts`に`customerAssetsQuerySchema`追加
4. **UI**: `src/lib/customerAssets/CustomerAssetEngine.ts`(集計の純粋関数)・`src/store/useCustomerAssetsStore.ts`・`src/components/admin/customerAssets/CustomerAssetsScreen.tsx`(テーブル表示・編集/削除UIなし)・`app/admin/customer-assets/page.tsx`
5. **テスト**(§5)
6. **スクリーンショット**(§6)
7. **本レポート**

## 4. 集計ロジック(すべて決定論的コード・LLM/AI不使用)

`src/lib/customerAssets/CustomerAssetEngine.ts` `computeCustomerAssets()`

| 項目 | 算出方法 |
|---|---|
| `visitCount` | 顧客の来店件数 |
| `lastVisitDate` | 来店日の最大値(来店0件はnull) |
| `totalSales` | 全来店の`treatment_amount+retail_amount`合計 |
| `ltv` | `totalSales + (継続中サブスクのmonthly_price合計) × 6`。解約済み(`cancelled_at`設定済み)サブスクはMRRに計上しない。複数の継続中サブスクがある場合は合算 |
| `nominationRate` | 全来店のうち`is_nomination=true`の割合(来店0件はnull) |
| `avgIntervalDays` | 来店間隔の平均(日数)。来店2回未満は算出不能のためnull(MD-2の`ChurnRiskEngine`と同じ考え方) |

顧客一覧はLTV降順(資産価値が高い順)で返す。

## 5. テスト結果

`npm test`: **37 files / 395 tests 全成功**(既存378件 + 本タスクで17件追加)
`npm run typecheck`: 本タスク関連ファイルはエラーなし。既存無関係2件のみ残存。

新規テスト:
- `tests/repositories/supabase/SubscriptionRepo.test.ts`(4件): 変換・空配列・フィルタ条件・エラー
- `tests/lib/customerAssets/CustomerAssetEngine.test.ts`(8件): 来店0件/来店回数・最終来店日・累計売上集計/LTV計算/解約済みサブスク除外/指名状況/来店間隔(2回未満null)/LTV降順ソート/複数サブスクのMRR合算
- `tests/api/customer-assets.test.ts`(5件): 一覧取得・バリデーション・0件時・エラー系

## 6. 実データ確認・スクリーンショット

`GET /api/admin/customer-assets?storeId=00000000-0000-0000-0000-000000000001`を実行し、**40件**の顧客資産一覧をLTV降順で取得できることを確認(最高額: 田中葵様 ¥137,610)。

`docs/screenshots/MD-3_customer_assets_real_data.png` — 実データで顧客名/来店回数/最終来店日/LTV/累計売上/指名状況/来店間隔の全列が正しく表示されることを確認。

現状、当店舗の継続中サブスクは0件のため、全顧客の`ltv === totalSales`(MRR寄与が0)になっている。これは設計どおりの正しい挙動(サブスク機能自体が現状未使用なため)。また全顧客が来店1回のため`avgIntervalDays`は全件「—」(null)表示になっている(MD-1/MD-2タスクで確認済みの「全39来店が初回来店」という事実と整合)。

## 7. 使用テーブル一覧

| テーブル | 用途 |
|---|---|
| `brain_customers` | 顧客一覧の基礎データ(`ICustomerRepo.listByStore()`) |
| `brain_visits` | 来店回数・最終来店日・累計売上・指名状況・来店間隔の算出元(`IVisitRepo.listByStore()`) |
| `brain_subscriptions` | LTVのMRR算出元(`ISubscriptionRepo.listByStore()`・本タスクで新規Repository追加) |

新規業務テーブルの追加なし(既存`brain_subscriptions`に対するRepository層の追加のみ)。

## 8. 残課題

1. **API認可(owner専用)の横断的な未検証**: MD-1/MD-2と同じ既知のギャップ(本タスクで新たに導入したものではない)
2. **大量顧客時のページネーション未実装**: 現状40件のため全件返却で問題ないが、顧客数が増えた場合は`GET /api/admin/customer-assets`にページネーション/検索パラメータの追加が必要になる可能性がある
3. **サブスク機能が実運用未開始**: `brain_subscriptions`に実データが入った時点でLTV計算(MRR×6部分)の実データ確認が別途必要
