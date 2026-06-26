# CSV Import Phase1 詳細設計（DDL確定版）

> **⚠️ SUPERSEDED (2026-06-20)**: `customers`/`profiles`/`staff_name_aliases`前提の旧設計。`brain_*`方針確定により**廃止**。`docs/architecture/CSVImportSecurityArchitecture.md`を正とする。本書は経緯記録としてのみ残置。

- 作成日: 2026-06-19
- 基準: `docs/CSV_IMPORT_FINAL_ARCHITECTURE.md`
- 位置づけ: Phase1（DBスキーマ適用準備）の詳細設計。**DDL設計のみ。実際の適用・コード変更は行わない。**

---

## 1. staff_name_aliases 設計

### 1.1 目的

CSV担当者名（テキスト・表記揺れあり）から`profiles.id`（uuid）への解決を、初回は人手で確定させ、以降は自動化するためのマッピング表。`profiles.staff_name`/`display_name`との完全一致だけでは「鈴木」「鈴木さん」「Suzuki」のような表記揺れを取り切れないことに対応する。

### 1.2 テーブル案

```sql
CREATE TABLE staff_name_aliases (
  alias       text PRIMARY KEY,
  staff_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_by  uuid REFERENCES profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_staff_name_aliases_staff_id ON staff_name_aliases (staff_id);
```

### 1.3 カラム案

| カラム | 型 | 説明 |
|---|---|---|
| `alias` | text | PK。`normalizeStaffName()`適用後の正規化済み文字列を保存（大文字小文字・全角半角・前後空白を統一した後の値） |
| `staff_id` | uuid | FK → `profiles.id`。このaliasが指すスタッフ |
| `created_by` | uuid | このマッピングを手動登録した管理者（`profiles.id`）。null許容（システム自動登録の場合） |
| `created_at` | timestamptz | 登録日時 |

`alias`をPKにすることで、同一alias文字列に対する重複登録を防ぐ（1つのaliasは1人のスタッフにのみ紐付く）。

### 1.4 解決フロー

```
CSV担当者名（生テキスト）
   │
   ▼
normalizeStaffName(raw)  ── 既存関数を再利用（表記揺れ除去・トリム）
   │
   ▼
① profiles.staff_name または display_name と完全一致検索
   │  一致 → profiles.id を確定（解決成功）
   │  不一致 ↓
   ▼
② staff_name_aliases.alias と完全一致検索
   │  一致 → staff_id を確定（解決成功）
   │  不一致 ↓
   ▼
③ 未解決（unresolved）として記録
```

①が優先されるのは、`profiles`側の正式名称が変更された場合に追従できるようにするため（aliasテーブルに古い名前が残っていても①で先に正しく解決される）。

### 1.5 dry-run検証方法

実際の書き込み（customers/reservations UPSERT）を行う前に、CSV全行に対して以下を実施する：

1. 全行から担当者名のユニーク集合を抽出（`Set<normalizedStaffName>`）
2. 集合内の各名前に対して§1.4の解決フローを実行（DBへの書き込みは発生しない、SELECTのみ）
3. 1件でも未解決があれば、インポート処理全体を**中断**し、以下を含むレポートを返す：
   - 未解決の担当者名一覧（正規化前の生テキストと正規化後の両方）
   - 各未解決名が出現するCSV行番号
4. 運用者は、未解決名を`staff_name_aliases`へ手動登録（管理画面 or 直接SQL、Phase2以降のUIで対応）した上で再実行する
5. 全件解決できた場合のみ、Pass A（顧客UPSERT）・Pass B（reservations UPSERT）へ進む

この「全件解決するまで一切書き込まない」方式により、一部の予約だけ担当者不明のまま中途半端に取り込まれる事態を防ぐ。

---

## 2. reservations.source 追加DDL

```sql
ALTER TABLE reservations
  ADD COLUMN source text;

COMMENT ON COLUMN reservations.source IS
  '予約データの取込元。CSV取込の場合は salonboard_import を設定。手動作成は NULL のまま運用。';
```

- **NOT NULL制約は付けない**: 既存の全予約データ（手動作成分）は`source`が無いため、NOT NULLにすると既存行に対する一括UPDATEが必要になり、影響範囲が不必要に広がる。NULL＝「取込元不明（従来の手動作成）」として扱う。
- **CHECK制約は付けない**: 将来`'manual'`や他の取込元（例: 他社POS連携）が増える可能性があり、固定の許可値リストを今の時点で決め切る根拠がないため。値の妥当性検証はアプリケーション層（Pass B書き込み時に`'salonboard_import'`を直接指定）で十分。

### 既存コードへの影響

`grep`で確認した結果、`reservations.source`を参照するコードは現状存在しない（新規列のため）。`select('*')`で全列取得しているクエリがあれば返り値オブジェクトに`source`フィールドが追加されるだけで、破壊的変更にはならない。

---

## 3. import_logs テーブルDDL

```sql
CREATE TABLE import_logs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source                text NOT NULL,
  file_name             text,
  total_rows            integer NOT NULL,
  inserted_customers    integer NOT NULL DEFAULT 0,
  updated_customers     integer NOT NULL DEFAULT 0,
  inserted_reservations integer NOT NULL DEFAULT 0,
  updated_reservations  integer NOT NULL DEFAULT 0,
  skipped_rows          integer NOT NULL DEFAULT 0,
  unresolved_staff_names text[],
  imported_by           uuid REFERENCES profiles(id),
  started_at            timestamptz NOT NULL DEFAULT now(),
  finished_at           timestamptz,
  status                text NOT NULL DEFAULT 'running'
                          CHECK (status IN ('running', 'completed', 'failed', 'aborted_unresolved_staff')),
  error_message         text
);

CREATE INDEX idx_import_logs_source_started_at ON import_logs (source, started_at DESC);
```

### カラムの意図

- `inserted_customers`/`updated_customers`/`inserted_reservations`/`updated_reservations`/`skipped_rows`: Pass A・Pass Bそれぞれの結果を分けて記録し、後から「何件新規顧客が増えたか」「何件が重複スキップされたか」を追跡可能にする
- `unresolved_staff_names`: dry-runで中断した場合、未解決名一覧をそのまま記録（再実行時の手がかりにする）
- `status`の`aborted_unresolved_staff`: dry-run中断を明示的に区別し、`failed`（予期しないエラー）と混同しないようにする
- `finished_at`がnullのまま長時間残っている行があれば、処理が異常終了した（例外でcatchされずプロセスが落ちた）ことの検知に使える

---

## 4. UNIQUE INDEX 詳細DDL

```sql
CREATE UNIQUE INDEX uq_reservations_csv_dedup
  ON reservations (
    customer_id,
    staff_id,
    ((scheduled_at AT TIME ZONE 'Asia/Tokyo')::date)
  )
  WHERE customer_id IS NOT NULL;
```

### 設計判断の根拠

| 判断 | 理由 |
|---|---|
| 部分インデックス（`WHERE customer_id IS NOT NULL`） | `reservations.customer_id`はnullable（実DB確認済み）。既存の手動予約に`customer_id IS NULL`の行が存在し得るため、それらを重複判定の対象外にする。NULLを含めるとPostgreSQLの一意制約上「NULLはNULLと等しいと評価されない」ため実害はないが、意図を明示するために条件を明記する |
| `(scheduled_at AT TIME ZONE 'Asia/Tokyo')::date`という式 | サーバー/セッションの`TimeZone` GUC設定に依存せず、常にJST基準の「日」で重複判定するため。セッション設定に依存する裸の`::date`キャストは、接続経路（PostgREST vs 直接psql等）によって異なるタイムゾーンで評価される危険がある |
| `staff_id`を含める | 同じ顧客が同日に複数スタッフから異なる施術を受けるケースを別予約として区別するため（`customer_id`のみでは正当な複数来店を誤って重複と判定してしまう） |

### ON CONFLICTでの利用

```sql
INSERT INTO reservations
  (customer_id, staff_id, menu, price, scheduled_at, duration_minutes, status, is_new_customer, notes, source)
VALUES
  ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
ON CONFLICT (customer_id, staff_id, ((scheduled_at AT TIME ZONE 'Asia/Tokyo')::date))
DO UPDATE SET
  menu      = EXCLUDED.menu,
  price     = EXCLUDED.price,
  notes     = EXCLUDED.notes,
  source    = EXCLUDED.source;
```

※ `ON CONFLICT`で式インデックスを指定する場合、INSERT文中の式が部分インデックスの式・WHERE句と完全一致している必要がある（PostgreSQLの制約）。実装時に注意。

---

## 5. duration_minutes = 60 固定での影響調査

### 5.1 調査結果

コードベース全体を検索した結果、`duration_minutes`/`durationMinutes`の使用箇所は以下の2種類のみ：

| 用途 | ファイル | 内容 |
|---|---|---|
| 表示のみ | `src/components/phase1/ServiceLogView.tsx:93`、`src/components/phase1/CustomerPage.tsx:182` | `{r.durationMinutes}分`という文字列表示。数値が画面に出るだけ |
| データ受け渡し | `src/store/useDashboardStore.ts`、`src/components/phase1/Phase1Screen.tsx`、`src/types/database.ts` | DB行→ストア→コンポーネントへの値の転送のみ |

**スケジュール重複判定・カレンダー枠計算・スタッフのダブルブッキング検知など、`duration_minutes`を使って「終了時刻」を計算し他の予約と衝突判定するロジックは存在しない。** 現在の予約システムは終了時刻を明示的に持たず、開始時刻（`scheduled_at`）と所要時間（`duration_minutes`）を表示用にのみ保持している。

### 5.2 既存スキーマとの整合性

`001_schema.sql`・`20250515000005_phase1_tables.sql`の両方で、`duration_minutes`は元々`INT NOT NULL DEFAULT 60`として定義されている。つまり**60分はこのテーブル自体の既存デフォルト値と一致**しており、CSV取込で60を固定値として書き込むことは既存の設計規約からの逸脱ではない。

### 5.3 結論・残存リスク

- **画面表示上の影響**: CSVインポートされた過去来店データ（`status='completed'`の履歴）について、`ServiceLogView.tsx`/`CustomerPage.tsx`で実際の施術時間と異なる「60分」が表示される可能性がある。これは見た目上の数値不一致であり、機能的な不具合（重複予約・ダブルブッキング等）には繋がらない
- **影響範囲は限定的**: 売上分析・churn分析・LTV分析等のロジックは`price`/`visit_count`/`scheduled_at`を参照しており、`duration_minutes`を集計に使っている箇所は見つからなかった（要: 実装時に`src/lib/analytics/`配下を再grepして最終確認）
- **対応方針**: 60分固定をPhase1の確定仕様として採用する。CSVに施術時間の実データが含まれる場合（現状の`SalonBoardRawRow`型には存在しない）、将来そのカラムを追加すれば精度向上が可能だが、現時点ではスコープ外とする

---

## 6. Phase1完了の定義

以下が全て揃った時点でPhase1完了とし、Phase2（スタッフ名解決ロジック実装）へ進める：

- [ ] 上記DDL（§2〜4）をユーザーが確認・承認
- [ ] `staff_name_aliases`/`import_logs`を必須にするか任意にするかの最終判断（`CSV_IMPORT_FINAL_ARCHITECTURE.md` §8で未決と記載済み）
- [ ] migrationファイルとしての作成・適用（本ドキュメントの範囲外、別途実施）
