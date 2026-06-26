# AI提案ブロッカー調査レポート

調査日: 2026-06-25
調査範囲: `no_customer_type`の発生原因(本番データ読み取りのみ・コード変更なし)
調査方法: `scripts/investigate_proposal_blocker.ts`(本番DB読み取り専用・既存の`generateCustomerProposal()`を無変更のまま全顧客に対して実行し集計。書き込みは一切行っていない)

## 結論(要約)

**`no_customer_type`は実装バグではなく、`brain_customers.customer_type`を設定する処理がシステム上どこにも存在しないために起きている、データ未整備の問題である。** 有効顧客40件、全件が原因不明のままNULLで、AI提案は1件も生成できない状態にある。一方、別システム(Phase1スタッフアプリの旧`customers`テーブル)には類似の分類列が30件中30件すべて設定済みであり、**分類自体は別システムで運用されているが、Riora Brain(`brain_customers`)側には一度も移行・反映されていない**ことが根本原因と判明した。

## 1. brain_customers件数

```
store_id = 00000000-0000-0000-0000-000000000001 の全行: 40件
  うちdeleted_at設定済み(論理削除): 0件
  有効(deleted_at IS NULL): 40件
```

## 2. customer_type別件数

`brain_customers.customer_type`の実スキーマ制約(`supabase/migrations/20260612000001_core_tables.sql:60`):
```sql
customer_type text CHECK (customer_type IN ('A_acne', 'B_pore', 'C_sensitive', 'D_aging', 'E_bridal'))
```

実測結果:
```
A_acne:      0件
B_pore:      0件
C_sensitive: 0件
D_aging:     0件
E_bridal:    0件
(NULL):     40件
```

ご質問にあった「VIP/定期/新規/離脱危険」という分類は、`brain_customers.customer_type`には存在しない。後述§5で判明したとおり、これに近い概念は**別システム(旧`customers`テーブル)の`customer_type`**(値: VIP型/慎重・不安型/感情重視型/効果重視型/信頼構築型)および`vip_rank`(0-3)・`churn_risk`(0-100)列に存在する。

## 3. NULL件数

```
customer_type IS NULL: 40件 / 有効顧客40件中(100%)
```

## 4. AI提案対象顧客数

`generateCustomerProposal()`(無変更・既存実装)を実在スタッフ(鈴木)で有効顧客40件全件に対して実行した。

```
対象顧客数: 40件(deleted_at IS NULLの全顧客)
```

## 5. 提案生成成功数

```
mandatory(本日の提案)が発火した顧客数: 0件 / 40件(0%)
```

40件全件が`PatternContextBuilder`の最初のゲート(`customerType`必須チェック)で停止しており、来店履歴解析・成功パターン照合以降のステージには一度も到達していない。

## 6. 失敗理由ランキング

```
no_customer_type: 40件(100%)
```

他の失敗カテゴリ(`no_visit_history`/`no_pattern_fired`/`degraded:*`)は0件。**現状は単一の原因で全顧客がブロックされている**ため、ランキングという形にはならず「`no_customer_type`一強」という結果になった。

## 7. 顧客重複件数(Pass D関連調査)

```
同姓同名で複数レコードが存在する人数: 6名(関与レコード数: 12件)
  深堀 直美: 2件(customer_type: NULL, NULL)
  崔 京子:   2件(customer_type: NULL, NULL)
  井口 悠:   2件(customer_type: NULL, NULL)
  大熊 萌:   2件(customer_type: NULL, NULL)
  松下 直樹: 2件(customer_type: NULL, NULL)
  鈴木 雅子: 2件(customer_type: NULL, NULL)

Pass D記載の6組のうち現在も重複: 6組(全件・解消されていない)
Pass D未記載で新たに見つかった重複: 0組
```

**Pass Dの重複と本件(`no_customer_type`)は無関係**と判定する。重複している12件も非重複の28件もすべて`customer_type`がNULLであり、重複の有無がNULLの発生に影響していない(重複・非重複を問わず100%NULL)。重複は別問題として依然未解消だが、AI提案がブロックされている直接原因ではない。

## 根本原因の特定(追加調査)

「customer_typeを設定する処理がコード上どこにあるか」を調査した結果、**`brain_customers.customer_type`に値を書き込む処理はリポジトリ全体に1箇所も存在しない**ことを確認した(`CustomerRepo.ts`は`customer_type`をSELECTのみ・INSERT/UPDATEする経路なし)。隣接列`type_confidence`(信頼度スコア)が存在することから、本来は何らかの分類エンジンが書き込む設計だったと推測されるが、その分類エンジン自体が未実装(もしくは未接続)である。

一方、**別システムの旧`customers`テーブル(Phase1スタッフアプリ・30件)には類似の`customer_type`列が存在し、実際に全30件に値が設定されている**:
```
VIP型:        4件
慎重・不安型:  9件
感情重視型:    5件
効果重視型:    5件
信頼構築型:    7件
```
ただし、このテーブルは`brain_customers`とは別のID空間(本タスク先行調査で判明した「音声メモ連携」と同じ構造的問題)であり、自動的に流用することはできない。

## まとめ

| 項目 | 結果 |
|---|---|
| brain_customers総数 | 40件 |
| customer_type設定済み | 0件(0%) |
| AI提案対象 | 40件 |
| 提案生成成功 | 0件(0%) |
| 失敗理由 | no_customer_type 100% |
| Pass D重複との関連 | なし(重複・非重複ともに100%NULL) |
| 根本原因 | brain_customers.customer_typeへの書き込み処理が未実装。類似分類は別システム(旧customers・30件全件設定済み)に存在するが未移行 |

## 本調査で変更したコード

なし(調査専用スクリプト`scripts/investigate_proposal_blocker.ts`を新規作成しただけで、既存コードへの変更は行っていない)。
