# ER図（本番Supabase実態ベース）

- 調査日: 2026-06-19
- 範囲: `customers` / `reservations` / `profiles` / `customers_pii` / `customers_secure`
- 凡例: 実線＝PostgREST OpenAPIで確認済みのFK。点線＝migrationファイル上の想定のみで実DBでは確認不能（クロススキーマFKのためOpenAPI非公開）。

```mermaid
erDiagram
    profiles {
        uuid id PK
        text role
        text staff_name
        text display_name
        timestamptz created_at
    }

    customers {
        uuid id PK
        text name
        text name_kana
        text phone
        text email
        text customer_type
        boolean is_vip
        integer visit_count
        integer total_spent
        date last_visit_date
        date next_visit_date
        integer churn_risk_score
        uuid assigned_staff_id FK
        text memo
        timestamptz created_at
        timestamptz updated_at
        text customer_hash_id
        integer avg_price
        text_array skin_tags
        integer line_response_rate
        text vip_rank
    }

    reservations {
        uuid id PK
        uuid customer_id FK
        uuid staff_id FK
        text menu
        integer price
        timestamptz scheduled_at
        integer duration_minutes
        text status
        boolean is_new_customer
        text notes
        timestamptz created_at
        text customer_hash_id FK
    }

    customers_pii {
        text hash_id PK
        text last_name_kana
        timestamptz created_at
        timestamptz updated_at
    }

    customers_secure {
        text hash_id PK_FK
        date birthday
        text skin_type
        numeric risk_score
        numeric ltv
        integer visit_count
        text customer_type
        boolean is_vip
        timestamptz last_visit_at
        text notes
        timestamptz created_at
        timestamptz updated_at
    }

    profiles ||--o{ customers : "assigned_staff_id (確認済み)"
    profiles ||--o{ reservations : "staff_id (確認済み)"
    customers ||--o{ reservations : "customer_id (確認済み)"
    customers_pii ||--o{ reservations : "customer_hash_id (確認済み)"
    customers_pii ||--|| customers_secure : "hash_id (確認済み)"
```

## 注記

1. **`customers`系と`customers_pii`/`customers_secure`系は別々の識別子空間**（UUID vs hash_id）であり、互いを直接結びつけるFKは確認できなかった。`reservations`が両方にFKを持つため、データモデル上は「同一の予約が2つの異なる顧客識別系から参照される」構造になっている。これは設計上の負債であり、CSV取込で新たな書き込み経路を追加する際は`customers`（UUID系）のみを対象とし、hash_id系には触れない方針を推奨する（詳細は`CSV_IMPORT_TARGET_SCHEMA.md`）。
2. `profiles.id → auth.users.id` のFKはSupabase標準パターンとして極めて可能性が高いが、PostgRESTのOpenAPIは`auth`スキーマを跨ぐFK情報を公開しないため、本ER図では**意図的に記載していない**（断定不可のため）。
3. `customer_visits`テーブルは実DBに存在しないため、本ER図には含めていない。過去の設計案（3テーブル同期）はこのテーブルの存在を前提としていたが、前提が成立しない。
4. UNIQUE制約・INDEX・CHECK制約・RLSポリシーの正確な定義はOpenAPI introspectionの範囲外であり、本ER図には反映されていない（`DB_AUDIT_REPORT.md` §0参照）。
