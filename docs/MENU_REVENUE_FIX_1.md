# MENU_REVENUE_FIX_1 — 人気メニューTOP3 売上表示修正報告

作成日: 2026-07-14

## 修正内容

`src/components/menu/MenuDashboard.tsx`の「人気メニューTOP3」売上表示を、
メニューマスタ価格(`menu.price`)から当月実売上(`menu.monthlyRevenue`)に変更。

```diff
- {formatYen(menu.price)}
+ {formatYen(menu.monthlyRevenue)}
```

`monthlyRevenue`は`MenuAnalyticsEngine.computeMenuAnalytics()`が
`brain_visits.treatment_amount`から既に集計してAPIレスポンス(`/api/admin/menu`)
に含めている値であり、今回はUIの参照フィールドを1行差し替えたのみ。
`MenuAnalyticsEngine`・API・DB・CSV取込のいずれも変更していない。

## 確認結果

**1. `npm run build`** — 成功（TypeScriptエラーなし、全66ルート生成）

**2. 390px確認** — 正常表示（下記スクリーンショット相当）

**3. 412px確認** — 正常表示（390pxと同一レイアウト・数値）

**4. 人気メニュー件数は変わらないこと** — 確認済み。修正前後とも
「今月4件」「今月3件」「今月2件」のまま変化なし（`monthlyCount`はもともと
`MenuAnalyticsEngine`が正しく計算していた値で、今回の修正対象外）。

**5. 売上が`monthlyRevenue`に一致すること** — 実際にページが受け取った
`/api/admin/menu`のレスポンスと画面表示を突き合わせて確認:

| メニュー名 | API `monthlyRevenue` | 画面表示 | API `monthlyCount` | 画面「今月n件」 |
|---|---|---|---|---|
| ハイドラフェイシャル | ¥24,200 | ¥24,200 | 4 | 今月4件 |
| ヒト幹15000 | ¥42,300 | ¥42,300 | 3 | 今月3件 |
| ハーブピーリング9900 | ¥16,400 | ¥16,400 | 2 | 今月2件 |

修正前は「ハイドラフェイシャル」が`menu.price`(未設定=0)を参照していたため
「¥0・今月4件」という誤表示だったが、修正後は実売上¥24,200が正しく表示される。

**6. STATSカード「売上 今月」への影響なし** — `¥195,000`（`-83%先月比`）は
修正前後で変化なし。このカードは`summary.monthlyRevenueTotal`を参照しており
（`STATS`配列、`人気メニューTOP3`の`menu.monthlyRevenue`とは別の値・別コード
パス）、今回変更した箇所とは無関係であることをAPIレスポンス
(`summary.monthlyRevenueTotal = 195000`)と画面表示の一致で確認した。

## 変更ファイル

- `src/components/menu/MenuDashboard.tsx`（1行変更のみ）

## commit / push

commit名: `MENU_REVENUE_FIX_1`
