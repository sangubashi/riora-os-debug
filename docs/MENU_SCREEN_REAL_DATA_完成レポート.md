# メニュー画面 実データ接続 完成レポート

- 実施日: 2026-06-25
- 対象画面: `/menu` (`src/components/menu/MenuDashboard.tsx`)
- 方針: 新規テーブル・migration・ダミーデータ追加は行わない。実データが存在しない指標はUI欄を残したまま「集計準備中」「未実装」「データ未蓄積」を明示する。

## 1. 事前調査(DB設計確認)

### 1.1 `brain_menus` の実体(本番Supabase・service_role直結で確認)

```
$ node scripts/probe_menu_tables.mjs
```

- 本番に6件存在(store_id固定: `00000000-0000-0000-0000-000000000001`)
- カラム: `id, store_id, name, price, role, target_types, created_at, deleted_at`
- `role`は `entry/pore/sensitive/peeling/lifting` の5種 + CSV取込時の名称未マッチ分を受ける `imported_other` 固定行(`CSV取込(メニュー名未マッチ)`, price=0)が1件
- `category`(facial/option/subscription)・`duration`・`is_active`・`is_subscribable`・`line_tags` 列は**存在しない**

### 1.2 旧スキーマ `salon_menus` / `salon_menu_options` / `salon_menu_analytics` / `salon_subscriptions`

`src/store/useMenuStore.ts` の既存 `fetchMenus/fetchOptions/fetchAnalytics` はこれらのテーブルを参照していたが、本番Supabaseに**存在しない**(`PGRST205: Could not find the table`)。MenuDashboard.tsx自体もこれらの関数を一度も呼び出していなかったため、本番では常にモック配列(`MOCK_MENUS`/`MOCK_OPTIONS`)がそのまま表示されていた。

### 1.3 関連Repository

- `src/repositories/supabase/MenuRepo.ts`(`IMenuRepo.listByStore`)が `brain_menus` を正しく参照する実装として既存(元々はCSV Importのメニュー名突合専用だが、データ取得自体はそのまま再利用可能)。
- `app/lib/repos.ts`(P0 API Layer・service_roleキー)経由でのみ呼び出される設計。クライアントから`brain_menus`を直接SELECTすることはRLS設計上想定されていない(`store_id = app_store_id()`が`current_setting('app.store_id')`GUC依存で、クライアントセッションには設定されない)。
- 既存の `MD-1〜MD-5`(経営ダッシュボード系画面)が `useXxxStore.fetchXxx(storeId)` → `GET /api/admin/xxx?storeId=...` → `getRepos()` → 集計Engine、という確立済みパターンを採用していたため、本対応も同パターンに統一した。

### 1.4 `DEMO_MODE`分岐

`src/lib/supabase.ts`の`DEMO_MODE=true`は維持(プロジェクト全体方針)。メニュー画面は新規に`fetch('/api/admin/menu?...')`方式に切り替えたため、`DEMO_MODE`分岐そのものに依存しない(他画面のVOICE_NOTES_LIVE同様、機能単位でモック依存を切り離した)。

## 2. モックデータの棚卸し結果と対応

| 箇所 | 内容 | 対応 |
|---|---|---|
| `useMenuStore.ts` `MOCK_MENUS`(10件) | category/duration/repeatRate等の固定値 | 削除。`fetch('/api/admin/menu')`の実データに置換 |
| `useMenuStore.ts` `MOCK_OPTIONS`(5件) | オプション一覧固定値 | 削除(`salon_menu_options`相当のテーブルが本番に存在しないため実データ化不可。将来テーブルが出来るまで対象外) |
| `MenuDashboard.tsx` `STATS`配列 | `総顧客数168名`/`売上¥1,280,000`/`+9.1%`等ハードコード | 実データ(メニュー数・今月売上・前月比)に置換。リピート率のみ実データソース無しのため「集計準備中/未実装」表示 |
| `MenuDashboard.tsx` AIおすすめカード | `vipConversionRate`(架空指標)で選定 | 実データ指標`nextVisitRate`(brain_visits.next_booking_made集計)で選定するよう変更 |
| `MenuDashboard.tsx` 売上レポートカード | `"今月の売上は先月比120%です"`固定文 + `BAR_HEIGHTS`固定配列 | 実データ(今月対前月の売上変化率/直近7日間の日別売上)に置換。前月データ不足時は「データ準備中」を明示 |
| `MenuDashboard.tsx` フィルタータブ | ラベル(顧客/予約/AI提案/設定)とキー(facial/option/subscription)が不一致で実質非機能 | `brain_menus.role`(entry/pore/sensitive/peeling/lifting)を実カテゴリとして再構成。AIおすすめ・人気TOP3に実際に反映されるよう接続 |
| `src/components/menu/MenuCard.tsx` `MenuEditSheet.tsx` `OptionSelector.tsx` `AIInsightPanel.tsx` `SubscriptionToggle.tsx` | いずれも`/menu`ルートから一度も参照されないデッドコード。category/duration/isSubscribable/lineTags/オプションCRUD等、実データソースが存在しない項目に依存 | 削除(到達不能かつ実データ化不可能なモック専用UIのため) |

## 3. 実装内容

1. `src/lib/menu/MenuAnalyticsEngine.ts`(新規)
   - `computeMenuAnalytics({ menus, visits, today })` 純粋関数(DB非依存・決定論ルール・LLM不使用、`CustomerAssetEngine`と同方式)
   - 実データで算出: `monthlyCount`/`monthlyRevenue`(今月)、`totalVisitCount`、`nextVisitRate`(全期間のnext_booking_made割合)、`summary.monthlyRevenueTotal`/`lastMonthRevenueTotal`/`momRevenueChangePct`、`summary.dailyRevenueLast7Days`
   - 実データソースが無い指標(`repeatRate`/`profitMargin`/`aiRecommendRate`/`upsellSuccessRate`/`vipConversionRate`)は常に`null`を返す
2. `app/api/admin/menu/route.ts`(新規) — `GET /api/admin/menu?storeId=...`。`repos.menuRepo.listByStore` + `repos.visitRepo.listByStore` を集計してJSON化。閲覧専用(GETのみ)
3. `src/store/useMenuStore.ts`(全面改修) — `fetchMenus(storeId)`が上記APIをfetchするだけのストアに変更。モック・salon_menus系のSupabase直叩きを全廃
4. `src/components/menu/MenuDashboard.tsx`(全面改修) — 実データ表示への置換(上表参照)。UIセクションは1つも削除していない(数値の出し先のみ実データ/明示プレースホルダに変更)
5. `src/store/index.ts` — 型再エクスポートを新しい型(`MenuAnalyticsRow`等)に追従
6. テスト追加: `tests/lib/menu/MenuAnalyticsEngine.test.ts`(6件)・`tests/api/menu.test.ts`(5件)。既存453件含め全テストグリーン、`npm run build`成功

## 4. Playwright実画面確認 結果

`http://localhost:3101/menu` を実ブラウザ(Chromium・390×844)で表示し、`/api/admin/menu?storeId=00000000-0000-0000-0000-000000000001` の本番データをそのまま描画。コンソールエラー無し。

実データ確認結果(本番Supabase時点):

```json
{
  "menus": [
    { "name": "ヒト幹15000",          "price": 15000, "role": "entry",     "monthlyCount": 0, "totalVisitCount": 0, "nextVisitRate": null },
    { "name": "毛穴洗浄+ヒト幹19000", "price": 19000, "role": "pore",      "monthlyCount": 0, "totalVisitCount": 0, "nextVisitRate": null },
    { "name": "水素+ヒト幹18000",     "price": 18000, "role": "sensitive", "monthlyCount": 0, "totalVisitCount": 0, "nextVisitRate": null },
    { "name": "ハーブピーリング9900", "price": 9900,  "role": "peeling",   "monthlyCount": 0, "totalVisitCount": 0, "nextVisitRate": null },
    { "name": "EMS+小顔19000",        "price": 19000, "role": "lifting",   "monthlyCount": 0, "totalVisitCount": 0, "nextVisitRate": null },
    { "name": "CSV取込(メニュー名未マッチ)", "price": 0, "role": "imported_other", "monthlyCount": 39, "totalVisitCount": 39, "nextVisitRate": 0 }
  ],
  "summary": {
    "totalMenuCount": 6,
    "monthlyRevenueTotal": 401150,
    "lastMonthRevenueTotal": 0,
    "momRevenueChangePct": null
  }
}
```

スクリーンショット: `docs/screenshots/menu_real_data.png`

## 5. データ品質に関する発見事項(調査のみ・対応は本タスク範囲外)

CSV Importで取り込まれた`brain_visits`39件は**全件**が名称未マッチの`imported_other`(`CSV取込(メニュー名未マッチ)`)に紐づいており、`ヒト幹15000`等の実メニュー5件には来店実績が1件も紐づいていない。そのため画面上は「人気メニューTOP3」が全て`今月0件`、「次回予約率トップ」も実メニューには対象が無く「データ集計中」表示になる(モックではなく実データの結果として正しい表示)。CSV Importのメニュー名寄せ精度改善は別タスクの範囲。

## 6. 禁止事項の遵守

- 新規テーブル: 作成していない(既存`brain_menus`/`brain_visits`のみ使用)
- migration: 追加していない
- ダミーデータ: 追加していない。実データが無い指標は値を埋めず`null`→UI側で「未実装」等を明示
- 推測値: 使用していない(`momRevenueChangePct`は前月実績0件の場合`null`を返し、UIで「前月データ不足」と表示)
