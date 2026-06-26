# SalonBoard CSV Import 最終アーキテクチャ（確定版）

> **⚠️ SUPERSEDED (2026-06-20)**: 本書は素の`customers`/`reservations`テーブルを前提にした旧設計。`docs/architecture/Riora_Management_Dashboard_Architecture_v2.1.md`の`brain_*`方針確定により**廃止**。実装は`docs/architecture/CSVImportSecurityArchitecture.md`を正とする。本書は経緯記録としてのみ残置。

- 作成日: 2026-06-19
- 位置づけ: **設計確定版**。実装はユーザー承認後に別途着手する。本ドキュメント自体はコード変更・migration適用を含まない。
- 基準: `docs/DB_AUDIT_REPORT.md`（本番Supabase実スキーマ、PostgREST OpenAPI introspectionで確認済み）
- 構成変更点: 過去案の「customers + customer_visits + reservations 3テーブル同期」は**廃案**。`customer_visits`が本番に存在しないため、**customers + reservations の2テーブル構成**に変更する。

## 0. 確定済み前提（実DB確認済み・再掲）

| 項目 | 確定内容 |
|---|---|
| `customer_visits` | 本番に**存在しない**。3テーブル同期案は不採用 |
| `reservations.staff_id` | `uuid NOT NULL`、FK → `profiles.id` |
| `reservations.customer_hash_id` | 存在する。但しFK先は`customers_pii.hash_id`（`customers`ではない）。**CSV取込ではこの列を一切操作しない**（hash_id系の並行アイデンティティ管理に干渉しないため） |
| `customers.vip_rank` | `text`型（integerではない） |
| `profiles.staff_id` | **存在しない**。スタッフ識別は`profiles.id`（uuid）のみ |
| `customers.customer_hash_id` | 存在する（`customers_pii.hash_id`とは無関係の別カラム）。既存`SalonBoardImportEngine.ts`の`nameToKey()`（djb2ハッシュ）で生成した値を顧客マッチングキーとして使う想定で実装済み |
| `customers.gender`/`prefecture`/`city` | 存在しない |
| `reservations.source` | 存在しない（新規追加が必要） |

## 1. 最終データフロー（customers + reservations 2テーブル構成）

```
SalonBoard CSV
   │
   ▼
salonBoardParser.ts ── parseSalonBoardCsv()
   │  (既存、変更なし。SalonBoardRawRow[] を返す。1行=1来店。
   │   phone/email/郵便番号/住所/生年月日の列は COLUMN_ALIASES に
   │   定義されていないため、そもそも一切読み取られない)
   ▼
SalonBoardRawRow[]
   │
   ├─ Pass A: 顧客集約・customers UPSERT ───────────────┐
   │   既存 aggregateCustomers() + enrichCustomers() を再利用│
   │   nameToKey() で customer_hash_id を生成              │
   │   customers.customer_hash_id で既存顧客を検索          │
   │     見つかった→UPDATE / 見つからない→INSERT           │
   │   churn_risk_score 等は customerRiskEngine.ts を再利用 │
   │   ※ customer_visits への insertVisit() 呼び出しは削除  │
   │                                                        │
   └─ Pass B: reservations 行ごとUPSERT（新規ロジック）──────┘
       Pass A 完了後の customers から customer_id を解決
       staff_id は新規実装の resolveStaffId() で profiles.id へ解決
       1行=1来店のまま reservations へ UPSERT
       source='salonboard_import' を付与
```

**Pass分割の理由**: 既存`aggregateCustomers()`はCSV全行を顧客単位に集約する設計（1顧客=1レコード）であり、`reservations`が要求する「1来店=1行」と粒度が異なる。集約後データから来店履歴を逆算するのではなく、生データ（`SalonBoardRawRow[]`）を別パスで直接`reservations`に書く方が既存ロジックを壊さず安全。

## 2. customer_id 解決方法（確定）

1. `nameToKey(customerName)`（既存・djb2ハッシュ、変更なし）でキー生成
2. `customers` を `customer_hash_id = key` で検索
3. 見つかった場合: 既存`customers.id`を使用。`visit_count`/`total_spent`/`last_visit_date`/`avg_price`/`vip_rank`/`churn_risk_score`等をPass Aで更新
4. 見つからない場合: 新規`customers`行をINSERT（`customer_hash_id`に生成キーを保存）し、新規発行された`id`を使用
5. **`customers_pii`/`customers_secure`（hash_id系）には一切書き込まない** — これらはCSV取込とは独立した別アイデンティティ系であり、混在させると整合性が崩れる

## 3. staff_id 解決方法（新規ロジック・要実装）

現状、CSV担当者名（テキスト）から`profiles.id`（uuid）へ解決するロジックは存在しない。新規実装方針：

1. `normalizeStaffName()`（既存・表記揺れ除去）で正規化
2. `profiles.staff_name` / `profiles.display_name` と完全一致（大文字小文字・全角半角を正規化した上で）で検索
3. 一致が0件または複数件の場合は**未解決**として扱う
4. **インポート実行前に全行を事前検証（dry-run）し、未解決のスタッフ名が1件でもあればインポート全体を中断**して未解決名一覧を表示する（部分的な不整合データを書き込まないため）
5. 運用上、表記揺れが恒常的に発生する場合に備え、`staff_name_aliases`テーブル（alias→profiles.id）を新設し、一度マッピングした別名は次回以降自動解決できるようにする（§5でDB変更として提案）

## 4. 重複判定キー（確定）

CSVは「来店日」のみ（時刻情報なし）。`reservations.scheduled_at`はtimestamptz NOT NULLのため、来店日をAsia/Tokyo正午（`12:00:00+09:00`）に固定して格納する規約とする（深夜帯のタイムゾーン境界ズレを避けるため）。

重複判定キー: `(customer_id, staff_id, 来店日)`

```sql
-- 実DBには customer_id が NULL のレコードも存在するため、
-- NULL を除外した部分インデックスとする
CREATE UNIQUE INDEX uq_reservations_csv_dedup
  ON reservations (customer_id, staff_id, ((scheduled_at AT TIME ZONE 'Asia/Tokyo')::date))
  WHERE customer_id IS NOT NULL;
```

書き込みは`ON CONFLICT (customer_id, staff_id, ((scheduled_at AT TIME ZONE 'Asia/Tokyo')::date)) DO UPDATE`とし、再インポート時に同一来店のmenu/price/notesを最新値で上書きできるようにする（冪等性確保）。

## 5. DB変更一覧（再確定・最小構成）

過去案にあった`customers.gender`/`prefecture`/`city`の追加は**今回のスコープから除外**する。理由: 既存`salonBoardParser.ts`の`COLUMN_ALIASES`は電話/メール/郵便番号/住所/生年月日の列を一切マッピングしておらず、現状のCSV取込パイプラインはこれらの値を読み取っていない。読み取っていないデータの保存先を追加することは「将来のための先行実装」に該当するため見送り、CSVに住所列を取り込む要件が実際に発生した時点で別途設計する。

| 区分 | 内容 | SQL |
|---|---|---|
| カラム追加 | `reservations.source` | `ALTER TABLE reservations ADD COLUMN source text;` |
| INDEX追加 | 重複判定用 部分UNIQUE INDEX | `CREATE UNIQUE INDEX uq_reservations_csv_dedup ON reservations (customer_id, staff_id, ((scheduled_at AT TIME ZONE 'Asia/Tokyo')::date)) WHERE customer_id IS NOT NULL;` |
| テーブル追加（推奨・任意） | スタッフ別名マッピング | `CREATE TABLE staff_name_aliases (alias text PRIMARY KEY, staff_id uuid NOT NULL REFERENCES profiles(id), created_at timestamptz NOT NULL DEFAULT now());` |
| テーブル追加（推奨・任意） | 取込履歴・監査ログ | `CREATE TABLE import_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source text NOT NULL, file_name text, total_rows integer NOT NULL, inserted_count integer NOT NULL, updated_count integer NOT NULL, skipped_count integer NOT NULL, unresolved_staff_names text[], imported_by uuid REFERENCES profiles(id), created_at timestamptz NOT NULL DEFAULT now());` |

`customers`テーブルへのカラム追加は**不要**（既存の`customer_hash_id`/`avg_price`/`vip_rank`/`skin_tags`/`line_response_rate`で十分）。

> **注**: 上記SQLは設計確定のための提示のみ。ユーザー承認後、別途migrationファイルとして作成し適用する。

## 6. 既存コード再利用率（再評価）

| ファイル | 再利用率 | 内容 |
|---|---|---|
| `salonBoardParser.ts` | **約95%** | そのまま再利用。変更不要 |
| `SalonBoardImportEngine.ts`（`aggregateCustomers`/`enrichCustomers`/`nameToKey`/`normalizeStaffName`系） | **約80%** | Pass Aの顧客集約ロジックとしてそのまま再利用 |
| `SalonBoardSaveEngine.ts`の`upsertCustomer()` | **約85%** | そのまま再利用（`customer_visits`への`insertVisit()`呼び出しのみ削除） |
| `SalonBoardSaveEngine.ts`の`insertVisit()` | **0%（削除）** | `customer_visits`が存在しないため丸ごと削除 |
| `SalonBoardSaveEngine.ts`の`insertActionLog()` | **100%** | 変更不要、そのまま利用 |
| reservations書き込みロジック（Pass B） | **新規実装（再利用率0%、ただし`nameToKey()`/`normalizeStaffName()`のみ部分再利用）** | 1行=1来店の生データ経路。既存コードに直接の対応物がない |
| staff_id解決ロジック | **新規実装** | 既存コードに存在しない |

全体の再利用率: **概算60〜65%**（顧客側の既存ロジックは高く再利用できるが、予約側は新規実装が中心）。

## 7. 実装Phase（再定義）

### Phase 1 — DBスキーマ適用準備
- §5のSQL（`reservations.source`追加、部分UNIQUE INDEX、`staff_name_aliases`、`import_logs`）をmigrationファイルとして作成
- ユーザー承認後に適用（本ドキュメントの範囲では未実施）

### Phase 2 — スタッフ名解決ロジック実装
- `resolveStaffId(staffName: string): { staffId: string } | { unresolved: string }` を新規実装
- `profiles.staff_name`/`display_name`との照合 → 不一致時は`staff_name_aliases`照合
- CSV全行を対象にdry-run検証を行い、未解決名が1件でもあれば書き込みを行わずエラーレポートを返す

### Phase 3 — 顧客解決・UPSERT実装（既存最大再利用）
- `aggregateCustomers()`/`enrichCustomers()`をそのまま使用
- `SalonBoardSaveEngine.upsertCustomer()`から`insertVisit()`呼び出しを削除した版を作成
- `customers.customer_hash_id`で既存顧客と紐付け、`customers.id`を確定

### Phase 4 — reservations書き込み実装（新規）
- `SalonBoardRawRow[]`を直接ループし、Phase3で確定した`customer_id`とPhase2で確定した`staff_id`を使って1行=1来店で`reservations`へUPSERT
- `scheduled_at`は来店日+正午固定、`source='salonboard_import'`、`status='completed'`、`is_new_customer`はPass A確定後の`visit_count`から判定、`duration_minutes`はCSVに情報がないため固定デフォルト値（60分）を採用する旨を明記
- `ON CONFLICT`で冪等性を確保（再インポート時は上書き、新規重複行は作成しない）

### Phase 5 — 運用化・検証
- `import_logs`への実行結果記録
- 既存`KpiDashboard.tsx`マウントの取込画面に管理者ロールゲート（`assertAdminAccess`）を追加（現状ロールゲートが一切ない点は別件として要修正— 本設計の範囲では指摘のみ）
- 同一CSVの再投入で重複が発生しないことを確認するテストケースを作成

## 8. 未解決・要判断事項（実装着手前にユーザー確認が必要）

1. `duration_minutes`のデフォルト値（60分を仮定。実際の施術時間バリエーションがある場合は別途ロジックが必要）
2. `staff_name_aliases`/`import_logs`は「推奨・任意」としたが、必須にするかどうかの最終判断
3. `customers`テーブルが現在`anon`キーから全件読み取り可能な状態（`DB_AUDIT_REPORT.md` §4、未修正）であるため、CSV取込で新規顧客データを追加すると同様に公開される。CSV取込実装の前提として、この問題への対応方針を別途決めるかどうか
