# CSV Import Migration レビュー結果（修正版反映後）

> **⚠️ SUPERSEDED (2026-06-20)**: レビュー対象の4本は素の`customers`/`reservations`/`profiles`前提の旧設計。`brain_*`方針確定により**この4本は適用しない**。`docs/architecture/CSVImportSecurityArchitecture.md`を正とする。本書は経緯記録としてのみ残置。

- 作成日: 2026-06-19
- 対象: `supabase/migrations/20260619_csv_import_*.sql` 4本
- 位置づけ: レビューのみ。コード変更・migration適用・本番変更は行わない。
- 適用状態: 4本とも**未適用**（このドキュメントはレビュー記録）

---

## 1. レビュー観点

1. 本番スキーマとの整合性
2. `reservations.customer_hash_id`との競合有無
3. `customers_pii`との競合有無
4. `import_logs`の設計妥当性
5. `staff_name_aliases`の運用妥当性
6. RLS適用方針

## 2. 検証方法

- 本番`reservations`テーブルを`service_role`キーで読み取り専用クエリし、実データ（140件）で重複判定キー`(customer_id, staff_id, JST日)`の重複有無を確認 → **重複0件**
- 同テーブルで`customer_id IS NULL`の件数 → **0件**
- 同テーブルで`customer_hash_id`列を使用している行数 → **0件**（`reservations`に`customer_hash_id`列自体が存在しないため該当なし。`customer_hash_id`は`customers`/`customers_pii`側の概念であり、`reservations`の重複判定キーとは独立している）

## 3. 初回レビュー結果（修正前）と対応状況

| ファイル | 初回判定 | 指摘内容 | 対応状況 |
|---|---|---|---|
| `20260619_csv_import_reservations_source.sql` | 問題なし | NOT NULL/CHECKを付けない判断は既存データとの整合性上妥当 | **変更なし（現状のままで採用、ユーザー確定済み）** |
| `20260619_csv_import_dedup_index.sql` | 問題なし | 部分インデックス・JST明示キャストとも妥当。実データで重複0件を確認済み | **変更なし（現状のままで採用、ユーザー確定済み）** |
| `20260619_csv_import_staff_name_aliases.sql` | 修正推奨 | RLSが「適用時に要判断」としてコメントアウトのまま保留されており、`customers`テーブルのPII漏洩（`docs/SECURITY_FIX_PROPOSAL_CUSTOMERS_RLS.md`参照）と同種の「RLS未確定のまま運用開始」リスクを内包していた | **修正済み**: `ENABLE ROW LEVEL SECURITY` + `REVOKE ALL FROM anon, authenticated` + owner専用ポリシー(`staff_name_aliases_owner_only`)を追加 |
| `20260619_csv_import_logs.sql` | 修正推奨 | 同上（RLS保留） | **修正済み**: 同様に`ENABLE ROW LEVEL SECURITY` + `REVOKE ALL FROM anon, authenticated` + owner専用ポリシー(`import_logs_owner_only`)を追加 |

## 4. 修正版の設計意図（RLS方針）

`staff_name_aliases`/`import_logs`はいずれも現状、**取込処理（service_role経由）からのみアクセスされる想定**である。`service_role`はGRANT/RLSの両方をバイパスするため、`anon`/`authenticated`からのテーブル権限を完全に剥奪しても現行の取込処理は影響を受けない。

`anon`/`authenticated`双方にGRANTを与えない一方で、`is_owner()`を使った owner専用ポリシーをこの時点で定義しておく理由は、Phase2（CSV管理画面）で`authenticated`にテーブルGRANTを追加する際、追加のmigrationなしにそのままポリシーが機能し、owner以外のauthenticated（スタッフ）には常にゼロ件しか見えない状態を最初から保証できるようにするため。`is_owner()`関数は本番に既存（PostgREST RPC一覧で確認済み）であり、既存の`customers_owner_all`等と同じパターンを再利用している。

## 5. 最終判定

| ファイル | 最終判定 |
|---|---|
| `20260619_csv_import_reservations_source.sql` | **問題なし** |
| `20260619_csv_import_dedup_index.sql` | **問題なし** |
| `20260619_csv_import_staff_name_aliases.sql` | **問題なし（RLS必須化により指摘事項解消）** |
| `20260619_csv_import_logs.sql` | **問題なし（RLS必須化により指摘事項解消）** |

## 6. 切り離した別問題

`customers`テーブルの`anon`向けPII公開問題は、CSV Import機能とは独立した既存不具合と判断し、`docs/SECURITY_FIX_PROPOSAL_CUSTOMERS_RLS.md`として別タスク化した。CSV Import側のmigration適用判断は、この別問題の解決を待つ必要はない。

## 7. 次のアクション（本書では未実施）

- [ ] 4本のmigrationファイルの最終承認
- [ ] 承認後、適用順序（`reservations_source` → `dedup_index` → `staff_name_aliases`/`import_logs`は順不同で問題なし）に従って別途適用
- [ ] `customers` PII問題は`docs/SECURITY_FIX_PROPOSAL_CUSTOMERS_RLS.md`側で別途方針確定
