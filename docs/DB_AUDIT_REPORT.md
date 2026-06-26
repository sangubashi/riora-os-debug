# DB監査レポート（本番Supabase = Source of Truth）

- 調査日: 2026-06-19
- 調査対象: `customers` / `reservations` / `profiles` / `customers_pii` / `customers_secure`
- 調査方法: PostgREST OpenAPI introspection（`GET /rest/v1/` with `service_role` key）+ `anon`/`service_role` 両キーでの読み取り専用HTTPプローブ
- **方針**: `supabase/migrations/*.sql` は信頼できる正典として扱わない。本レポートの内容は全て本番DBへの直接アクセスで確認した事実のみを記載する。

## 0. 重要な前提（調査手段の限界）

今回使える資格情報（`NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`、いずれも`.env.local`）では、PostgRESTの`/rest/v1/`（OpenAPI形式のスキーマ定義）以外に直接SQLを実行する手段がない。そのため以下は**取得不能**：

| 項目 | 取得可否 | 理由 |
|---|---|---|
| カラム一覧・型 | ✅ 取得済み | OpenAPI `definitions.<table>.properties` |
| PK | ✅ 取得済み | OpenAPI `<pk/>` アノテーション |
| FK | ✅ 取得済み | OpenAPI `<fk table=... column=.../>` アノテーション |
| UNIQUE制約 | ❌ 不可 | OpenAPIはUNIQUE/INDEXを公開しない。`pg_catalog`/`information_schema`への問い合わせ手段（RPC等）が存在しない |
| CHECK制約の本文 | ❌ 不可 | 同上 |
| INDEX一覧 | ❌ 不可 | 同上 |
| RLSポリシー本文 | ❌ 不可 | 同上。`anon`/`service_role`の**挙動差分**から間接的に推測することのみ可能（§4参照） |

→ UNIQUE/CHECK/INDEX/RLSの確定情報が必要な場合は、Supabase Dashboard の SQL Editor または `psql` 直接接続（接続文字列は `.env*` のいずれにも存在しない）が必須。

## 1. テーブル別カラム一覧（実DB確認済み）

### 1.1 `customers`

| カラム | 型 | NULL許可 | 備考 |
|---|---|---|---|
| id | uuid | NOT NULL | PK |
| name | text | NOT NULL | |
| name_kana | text | NULL可 | |
| phone | text | NULL可 | |
| email | text | NULL可 | |
| customer_type | text | NOT NULL | |
| is_vip | boolean | NOT NULL | |
| visit_count | integer | NOT NULL | |
| total_spent | integer | NOT NULL | |
| last_visit_date | date | NULL可 | |
| next_visit_date | date | NULL可 | |
| churn_risk_score | integer | NOT NULL | ※`churn_risk`という列名は存在しない |
| assigned_staff_id | uuid | NULL可 | FK → `profiles.id` |
| memo | text | NULL可 | |
| created_at | timestamptz | NOT NULL | |
| updated_at | timestamptz | NOT NULL | |
| customer_hash_id | text | NULL可 | 外部連携用ハッシュID（コメント明記） |
| avg_price | integer | NULL可 | 平均客単価 |
| skin_tags | text[] | NULL可 | |
| line_response_rate | integer | NULL可 | |
| vip_rank | **text** | NULL可 | ⚠️ `20260607_customers_missing_columns.sql`は`integer DEFAULT 0`と定義しているが、実DBは**text**型（デフォルト値の存在は今回未確認） |

**ファイルとの差分**: `gender`/`prefecture`/`city`列は実DBに**存在しない**（CSV取込でPII方針に沿った住所TRANCATE機能を実装するなら新規追加が必要）。

### 1.2 `reservations`

| カラム | 型 | NULL許可 | 備考 |
|---|---|---|---|
| id | uuid | NOT NULL | PK |
| customer_id | uuid | NULL可 | FK → `customers.id` |
| staff_id | **uuid** | NOT NULL | FK → `profiles.id`。※`20250515000005_phase1_tables.sql`は`TEXT NOT NULL`（FKなし）と定義しているが実DBは**uuid + FK**（001_schema.sql側が採用されている） |
| menu | text | NOT NULL | |
| price | integer | NOT NULL | |
| scheduled_at | timestamptz | NOT NULL | |
| duration_minutes | integer | NOT NULL | |
| status | text | NOT NULL | |
| is_new_customer | boolean | NOT NULL | |
| notes | text | NULL可 | |
| created_at | timestamptz | NOT NULL | |
| customer_hash_id | text | NULL可 | **FK → `customers_pii.hash_id`**（`customers.customer_hash_id`ではない点に注意） |

**ファイルとの差分**: `customer_name`列は実DBに**存在しない**（`20250515000005_phase1_tables.sql`はスナップショット用にこの列を定義しているが未適用）。`source`列も存在しない。

### 1.3 `profiles`

| カラム | 型 | NULL許可 | 備考 |
|---|---|---|---|
| id | uuid | NOT NULL | PK |
| role | text | NOT NULL | |
| staff_name | text | NOT NULL | |
| display_name | text | NULL可 | |
| created_at | timestamptz | NOT NULL | |

**ファイルとの差分**: `staff_id`列は実DBに**存在しない**。`005_rls_roles_grants.sql`の`riora_current_staff_id()`関数等は存在しないカラムを参照しており、適用されていれば実行時エラーになる（＝このRLS関数群は本番で機能していない可能性が高い）。

### 1.4 `customers_pii`（既存設計が把握していなかった並行テーブル）

| カラム | 型 | NULL許可 | 備考 |
|---|---|---|---|
| hash_id | text | NOT NULL | PK |
| last_name_kana | text | NULL可 | |
| created_at | timestamptz | NOT NULL | |
| updated_at | timestamptz | NOT NULL | |

### 1.5 `customers_secure`（既存設計が把握していなかった並行テーブル）

| カラム | 型 | NULL許可 | 備考 |
|---|---|---|---|
| hash_id | text | NOT NULL | PK / FK → `customers_pii.hash_id` |
| birthday | date | NULL可 | |
| skin_type | text | NULL可 | |
| risk_score | numeric | NOT NULL | |
| ltv | numeric | NOT NULL | |
| visit_count | integer | NOT NULL | |
| customer_type | text | NULL可 | |
| is_vip | boolean | NOT NULL | |
| last_visit_at | timestamptz | NULL可 | |
| notes | text | NULL可 | |
| created_at | timestamptz | NOT NULL | |
| updated_at | timestamptz | NOT NULL | |

## 2. FK一覧（実DB確認済み・確定）

| From | To | 列 |
|---|---|---|
| `customers.assigned_staff_id` | `profiles.id` | uuid |
| `reservations.customer_id` | `customers.id` | uuid |
| `reservations.staff_id` | `profiles.id` | uuid |
| `reservations.customer_hash_id` | `customers_pii.hash_id` | text |
| `customers_secure.hash_id` | `customers_pii.hash_id` | text |

`profiles.id → auth.users.id` のFKはmigrationファイル上の想定だが、PostgRESTのOpenAPIはSupabase管理スキーマ（`auth`）を跨ぐFKを公開しないため、**今回の調査では確認不能**（存在を否定するものではない）。

## 3. 既存設計との重大な齟齬（まとめ）

| 項目 | ファイル上の想定 | 実DB |
|---|---|---|
| `customer_visits`テーブル | 存在する前提（3テーブル同期設計の中核） | **存在しない**（`PGRST205`） |
| `reservations.staff_id`型 | ファイルにより`uuid`/`text`で矛盾 | `uuid` + FK確定 |
| `reservations.customer_name` | 存在する前提のファイルがある | **存在しない** |
| `profiles.staff_id` | 複数migrationが参照 | **存在しない** |
| `customers.churn_risk` vs `churn_risk_score` | ファイルにより表記揺れ | `churn_risk_score`のみ存在 |
| `customers.vip_rank`型 | `integer DEFAULT 0` | **text** |
| `customers.gender`/`prefecture`/`city` | CSV取込設計が追加前提 | 存在しない（新規追加が必要） |
| `reservations.customer_hash_id`の参照先 | 設計時点では未把握 | `customers_pii.hash_id`（`customers`ではない） |

## 4. セキュリティ上の発見事項（調査のみ・未修正）

> **この項目は今回のタスクの過程で偶発的に発見したものです。ユーザーの明示的な指示により、調査・記録のみを行い、修正（RLS変更・GRANT変更等）は一切行っていません。**

### 4.1 事実

`anon`公開キー（クライアントJSバンドルに同梱される`NEXT_PUBLIC_SUPABASE_ANON_KEY`）で以下を確認：

| テーブル | anonでの結果 |
|---|---|
| `customers` | **全30件を無制限に取得可能**（`service_role`と同一件数。`Content-Range: 0-0/30`が両キーで一致） |
| `reservations` | `42501 permission denied`（テーブルへのGRANT自体が無い） |
| `profiles` | `42501 permission denied` |
| `customers_pii` | `42501 permission denied` |
| `customers_secure` | `42501 permission denied` |

### 4.2 影響

`customers`テーブルの全カラム（氏名・氏名カナ・電話番号・メールアドレス・来店履歴・売上金額・churn_risk_score・VIPランク・メモ等）が、`anon`キーを知っている第三者から認証なしで全件読み取り可能な状態。`NEXT_PUBLIC_SUPABASE_ANON_KEY`はNext.jsのクライアントバンドルに含まれ公開情報相当のため、**実質的に全顧客PIIが公開されている状態に等しい**。

### 4.3 推定原因（未確定）

`supabase/migrations/*.sql`には`customers_owner_all`/`customers_staff_select`等、`is_owner()`または`auth.uid()`に依存するRLSポリシーが定義されている。`anon`ロールには`auth.uid()`が存在しないため、これらのポリシーが正しく適用されていれば`anon`は0件しか見えないはずである。実際には全件見えるため、以下のいずれかが本番で発生していると推定される（pg_catalogへのアクセス手段がないため確定不可）：

1. `customers`テーブルでRLSが無効化されている（`ALTER TABLE customers DISABLE ROW LEVEL SECURITY`）
2. `anon`ロールに対して`USING (true)`相当の許可ポリシーが別途追加されている

### 4.4 対応

ユーザーの指示により**今回は対応しない**。次回以降、ユーザーから明示的な修正指示があった場合に対応する。

## 5. CSV取込設計への影響

- 「customers + customer_visits + reservations の3テーブル同期」案は前提テーブル（`customer_visits`）が実DBに存在しないため**そのままでは実行不可**。`docs/CSV_IMPORT_TARGET_SCHEMA.md`で代替方針を提示する。
- `customer_id`解決は`customers`テーブル（UUID PK）を使う。`customers_pii`/`customers_secure`系（hash_idベース）は別の識別子系であり、CSV取込の主経路としては使わない（混在させると整合性が崩れる）。
- `staff_id`解決には`profiles.id`（UUID）が必要。CSVには担当者名（テキスト）しかなく、既存コードに名前→UUIDの解決ロジックは存在しない（`normalizer.ts`の`normalizeStaffName()`は表記揺れ除去のみ）。新規実装が必要。
