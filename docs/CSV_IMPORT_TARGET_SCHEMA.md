# CSV取込（SalonBoard）設計のためのスキーマ基準資料

> **⚠️ SUPERSEDED (2026-06-20)**: 素の`customers`/`reservations`/`profiles`を基準とした旧設計。`brain_*`方針確定により**廃止**。`docs/architecture/CSVImportSecurityArchitecture.md`を正とする。本書は経緯記録としてのみ残置。

- 作成日: 2026-06-19
- 目的: 今後CSV取込のDB変更を検討する際、`docs/DB_AUDIT_REPORT.md`で確認した**実DB**を唯一の基準として参照できるようにする。
- 位置づけ: これはスキーマの**現状整理**であり、新規migration・コード変更を含まない（本タスクの制約に準拠）。

## 1. 現状の実DBで使える既存カラム（CSV取込にそのまま使えるもの）

### `customers`（顧客本体・UUID PK）
書き込み対象として使えるカラム: `name`, `name_kana`, `phone`, `email`, `customer_type`, `is_vip`, `visit_count`, `total_spent`, `last_visit_date`, `next_visit_date`, `churn_risk_score`, `assigned_staff_id`, `memo`, `customer_hash_id`, `avg_price`, `skin_tags`, `line_response_rate`, `vip_rank`

PII方針（電話/メール/郵便番号/番地は保存しない）との関係:
- `phone`/`email`列自体は存在するが、PII方針上**書き込まない**（NULLのまま運用）
- 住所（都道府県＋市区町村）を保存する列は**存在しない** → 新規列が必要（`prefecture` text, `city` text）。性別を保存する`gender`列も**存在しない**。

### `reservations`（予約・UUID PK）
書き込み対象として使えるカラム: `customer_id`, `staff_id`, `menu`, `price`, `scheduled_at`, `duration_minutes`, `status`, `is_new_customer`, `notes`

`source`列（`salonboard_import`を識別するため）は**存在しない** → 新規列が必要。

### `profiles`（スタッフ・UUID PK）
CSVの担当者名から`staff_id`を解決するための読み取り専用参照先。`staff_name`/`display_name`で名前マッチングする以外の手段はない（一意性は保証されない）。

## 2. CSV取込のために不足しているもの（実DB上に存在しない）

| 不足要素 | 理由 |
|---|---|
| `customer_visits`テーブル | 過去の「3テーブル同期」設計の前提だったが実DBに存在しない。`RevenueAttributionEngine.ts`がこのテーブルに依存しているため、**テーブルが存在しないと当該機能はそもそも動作していない**可能性がある（要別途確認、本タスクの範囲外） |
| `customers.prefecture` / `customers.city` | PII方針の住所TRUNCATE保存先 |
| `customers.gender` | 性別保存先 |
| `reservations.source` | `salonboard_import`等の取込元識別 |
| `import_logs`テーブル | 取込履歴の記録先（重複防止・再実行管理に必要） |
| CSV担当者名 → `profiles.id` の解決ロジック | 既存コードに存在しない。`normalizer.ts`の`normalizeStaffName()`は表記揺れ除去のみで、UUIDへのマッピングは行わない |
| CSV顧客 → `customers.id` の解決ロジック | 既存の`SalonBoardImportEngine.ts`は氏名のdjb2ハッシュ（`nameToKey()`）で顧客を集約しているが、これは`customers.id`（UUID）でも`customers.customer_hash_id`でもなく、独自の一時キー。`customers`テーブルとの紐付けロジックは現状存在しない |

## 3. 既知の構造的リスク（実装前に意識すべき点）

1. **`customers`系とhash_id系（`customers_pii`/`customers_secure`）は別の識別子空間。** `reservations.customer_hash_id`は`customers_pii.hash_id`を参照しており、`customers.customer_hash_id`（同名だが別カラム）とは無関係。CSV取込が`customers.id`（UUID）を主キーとして使う場合、`reservations.customer_id`に書き込めばよく、`reservations.customer_hash_id`列には触れない方針が安全（hash_id系の整合性を壊さないため）。
2. **`customers`テーブルは現在`anon`キーから全件読み取り可能な状態**（`DB_AUDIT_REPORT.md` §4）。CSV取込で新たに住所・性別等の列を追加する場合、この問題が解消されるまでは追加データも同様に公開状態になる点に注意（対応はユーザー指示待ち、現状未修正）。
3. **既存の集計ロジック（`SalonBoardImportEngine.ts`の`aggregateCustomers()`）はCSV行を顧客単位に集約する設計**であり、「1来店1行」を要求する`reservations`への書き込みとは粒度が異なる。集約前の生データ（`SalonBoardRawRow[]`、1行=1来店、日付のみで時刻情報なし）を別経路で`reservations`に流す実装が必要（既存の集約後オブジェクトをそのまま転用できない）。
4. **`vip_rank`はtext型**（`SalonBoardSaveEngine.ts`がinteger相当の値を書き込んでいないか確認が必要 — 既存コードの動作検証は本タスクの範囲外のため未実施）。

## 4. 次の設計ステップで確認すべきこと（本資料の範囲外）

- `customer_visits`が存在しないことで`RevenueAttributionEngine.ts`が実際に正常動作しているかの実機確認
- 上記「不足要素」をどう追加するか（カラム追加 / 新規テーブル作成）はユーザーの承認を得た上で別途migration設計を行う
- `customers`テーブルのRLS/GRANT問題への対応方針（ユーザー指示待ち）
