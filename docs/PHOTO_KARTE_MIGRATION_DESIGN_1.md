# 写真カルテ機能 migration設計書 (PHOTO_KARTE_MIGRATION_DESIGN_1)

作成日: 2026-09-02(2026-09-02追記: migrationファイル作成後のユーザーレビューを反映)
前提: [[PHOTO_KARTE_DB_DESIGN_1]]・[[PHOTO_KARTE_API_DESIGN_1]]

> **2026-09-02追記**: 実際にmigrationファイル
> (`supabase/migrations/20260902000000_brain_customer_photos.sql`)を作成した後の
> ユーザーレビューで3点の追加確認を実施した。結果は本書末尾の3つの新設節
> (「CREATE TABLE IF NOT EXISTSの再検討」「riora_backupの権限について」
> 「store_id/customer_id/visit_id/created_byの整合性」)に記録し、本文中の
> 該当箇所も訂正済み。特に「service_roleのみがアクセス可能」という当初の
> 記述は不正確であり、訂正している(riora_backupも読み取り可能)。
ステータス: **設計のみ。** migrationファイル・SQLファイルは作成していない。DB接続・DB変更・
Storage変更・コード変更・commit/pushは一切行っていない。本書中のSQLはすべて
「設計内容を明確にするための記述例」であり、そのまま実行可能な独立したSQLファイルとしては
出力していない。

本書作成にあたり、Supabase MCP(読み取り専用クエリ)で本番プロジェクト`Riora-System`
(project_id: ohszxgajckzphhfhdrsv)の以下を再調査した:
- `karte_imports`の2段階migration(初期実装→`service_role`限定への引き締め)の実際のSQL
- `public`スキーマの`pg_default_acl`(新規テーブルにデフォルトで誰が権限を持つか)
- `brain_customer_photos`という名前・関連する索引名・ポリシー名が本番に存在しないこと

---

## 0. 最重要の発見: karte_importsは「後から引き締めた」実例そのものだった

`20260807010000_karte_import.sql`(初期実装)は`RLS: USING(true)/WITH CHECK(true)`+
`GRANT ... TO authenticated, service_role`という緩い状態で作られ、翌日
`20260808000000_karte_imports_service_role_only.sql`で
`REVOKE ... FROM authenticated`+`RLSポリシーをTO service_roleへ置換`という引き締めが
行われていた(コメントに「監査で発覚し是正した」という経緯が明記されている)。

**本書はこの「最終的な引き締め後の形」を写真カルテの初期実装から直接採用する**
(緩い状態を経由しない)。具体的には、RLSポリシー自体は作成するが対象ロールを
`service_role`のみに限定し、`authenticated`にはGRANTしない、という
`20260808000000`の最終形をそのままテンプレートにする。

これは[[PHOTO_KARTE_DB_DESIGN_1]]10節で示した「ポリシーを一切作らない」案からの
**修正**である。理由は5節で述べる。

### 0-1. 新規テーブルはデフォルトで`authenticated`に権限を持たない(実測確認済み)

本番の`pg_default_acl`(`public`スキーマ、`postgres`ロールが作成するテーブル)を確認したところ、
自動的に権限が付与されるのは`riora_backup`ロール(SELECTのみ、バックアップ用途)だけであり、
`authenticated`/`anon`への自動GRANTは存在しない。したがって**新規テーブルは何もGRANTしなければ
`authenticated`は最初から触れない**。`karte_imports`が事後に`REVOKE`を必要としたのは、
最初から`GRANT ... TO authenticated`を書いてしまっていたためであり、
`brain_customer_photos`では最初からその記述をしなければ`REVOKE`自体が不要になる。

---

## 1. テーブル定義

[[PHOTO_KARTE_DB_DESIGN_1]]4節・[[PHOTO_KARTE_API_DESIGN_1]]5-1節・10節・11節の内容を
統合した最終形。

```sql
-- 設計内容の記述例(このファイル自体はmigrationとして作成・実行しない)
-- 2026-09-02訂正: IF NOT EXISTS は使わない(末尾「CREATE TABLE IF NOT EXISTSの
-- 再検討」節を参照。新設テーブルのためfail-fastを優先する)。
CREATE TABLE public.brain_customer_photos (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       uuid        NOT NULL REFERENCES public.brain_stores(id)    ON DELETE CASCADE,
  customer_id    uuid        NOT NULL REFERENCES public.brain_customers(id) ON DELETE CASCADE,
  visit_id       uuid                 REFERENCES public.brain_visits(id)    ON DELETE SET NULL,
  body_part      text        NOT NULL,
  photo_type     text        NOT NULL DEFAULT 'progress'
                              CHECK (photo_type IN ('before', 'after', 'progress')),
  storage_path   text        NOT NULL,
  taken_at       timestamptz NOT NULL DEFAULT now(),
  created_by     uuid                 REFERENCES public.brain_staff(id)     ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,

  CONSTRAINT ux_brain_customer_photos_storage_path UNIQUE (storage_path)
);
```

### 1-1. カラムごとの整理

| カラム | 型 | NOT NULL | DEFAULT | PK/FK | ON DELETE | ON UPDATE | 備考 |
|---|---|---|---|---|---|---|---|
| `id` | uuid | ○ | `gen_random_uuid()` | PK | — | — | 他の`brain_*`と同一パターン |
| `store_id` | uuid | ○ | なし | FK→`brain_stores(id)` | CASCADE | 指定なし(NO ACTION) | `brain_customers`/`brain_visits`と同一パターン |
| `customer_id` | uuid | ○ | なし | FK→`brain_customers(id)` | CASCADE | 指定なし | `brain_visits.customer_id`と同一パターン。`customers`(legacy)は参照しない([[PHOTO_KARTE_DB_DESIGN_1]]3-1節) |
| `visit_id` | uuid | ×(nullable) | なし | FK→`brain_visits(id)` | SET NULL | 指定なし | 単発撮影を許容するためnullable |
| `body_part` | text | ○ | なし | — | — | — | CHECK制約なし(語彙はアプリ層管理、[[PHOTO_KARTE_DB_DESIGN_1]]6節) |
| `photo_type` | text | ○ | `'progress'` | — | — | — | CHECK 3値のみ |
| `storage_path` | text | ○ | なし | — | — | — | **UNIQUE制約あり(8節で理由を詳述)** |
| `taken_at` | timestamptz | ○ | `now()` | — | — | — | 撮影日時。`created_at`とは独立 |
| `created_by` | uuid | ×(nullable) | なし | FK→`brain_staff(id)` | SET NULL | 指定なし | **`auth.users`ではなく`brain_staff`を参照(7節で確定理由を再掲)** |
| `created_at` | timestamptz | ○ | `now()` | — | — | — | 標準 |
| `deleted_at` | timestamptz | ×(nullable) | なし | — | — | — | 論理削除 |

### 1-2. ON UPDATEを指定しない理由

既存の`brain_*`系テーブルのFKを全て確認したが、`ON UPDATE`句を指定している例は
1件もなかった(全てデフォルトのNO ACTION)。理由は各テーブルの主キーが
`gen_random_uuid()`で一度生成された後は更新されない設計のため、`ON UPDATE CASCADE`等が
実質的に意味を持たないからだと考えられる。本テーブルも同じ前提に従い、`ON UPDATE`は
指定しない(既存パターンへの準拠)。

---

## 2. Storage path

[[PHOTO_KARTE_API_DESIGN_1]]10節で確定した設計をそのまま踏襲する。

```
{store_id}/{customer_id}/{clientRequestId}.webp
```

`storage_path`列にはこの実際の文字列をそのまま保存する。`id`(photo_id)とファイル名を
一致させる設計にはしない。DB側では`storage_path`は単なる`text`型の列であり、
`photo_id`との対応関係は「同じ行に入っている」という以上の特別な制約を持たせない
(8節のUNIQUE制約が、パスの一意性という別の目的で存在する)。

---

## 3. インデックス

### 3-1. 実際のAPIアクセスパターンの再確認([[PHOTO_KARTE_API_DESIGN_1]]1〜4節より)

| API | クエリパターン |
|---|---|
| `GET .../photos`(既定) | `customer_id = ? AND deleted_at IS NULL ORDER BY taken_at DESC` |
| `GET .../photos?visitId=`(Before/After比較) | `customer_id = ? AND visit_id = ? AND deleted_at IS NULL` |
| `GET .../photos?bodyPart=`(経過比較) | `customer_id = ? AND body_part = ? AND deleted_at IS NULL`(→アプリ側で`brain_visits.visit_count_at`順に並べ替え) |
| `POST .../photos`(冪等性チェック) | `storage_path = ?` |
| `DELETE .../photos/[photoId]`(所有権確認) | `id = ? AND customer_id = ?` |

Phase1に存在しない(=今回は不要と判断する)パターン: 店舗横断の一覧、
「自分が撮った写真だけ」の一覧、単純な`created_at`ソートのみの一覧。

### 3-2. 採用するインデックス

```sql
-- 設計内容の記述例
CREATE INDEX IF NOT EXISTS idx_brain_customer_photos_customer_taken
  ON public.brain_customer_photos (customer_id, taken_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_brain_customer_photos_customer_bodypart
  ON public.brain_customer_photos (customer_id, body_part)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_brain_customer_photos_visit
  ON public.brain_customer_photos (visit_id)
  WHERE deleted_at IS NULL;
```

`ux_brain_customer_photos_storage_path`(1節のUNIQUE制約)はPostgresが自動的に
一意インデックスとしても機能するため、`storage_path`単体の検索(冪等性チェック)は
追加のインデックスなしでこれを利用できる。

### 3-3. 採用しない(過剰と判断した)インデックス

| 候補 | 判断 | 理由 |
|---|---|---|
| `store_id, created_at DESC` | **不採用**(Phase1では) | [[PHOTO_KARTE_DB_DESIGN_1]]11節では提案していたが、店舗横断の一覧APIはPhase1の5エンドポイントに存在しない。Phase2で管理画面的な店舗横断ビューを作る際に追加すればよく、今作る根拠がない |
| `created_by` | **不採用** | 「自分が撮影した写真だけを見る」というAPI・UIがPhase1に存在しない |
| `client_request_id`単体 | **該当なし** | [[PHOTO_KARTE_API_DESIGN_1]]10-2節の決定通り、`client_request_id`は列として保存しないため、そもそも対象が存在しない |
| `taken_at`単体(customer_idなし) | **不採用** | 全顧客横断で日付順に見るAPIが存在しない。複合インデックス(3-2節1つ目)で十分 |

[[PHOTO_KARTE_DB_DESIGN_1]]11節が提案していた4本目のインデックス(store_id複合)を
**本書では不採用に変更する**。DB設計書からの修正点として記録する。

---

## 4. GRANT

### 4-1. 既存パターンの確認結果

- `karte_imports`(引き締め後): `GRANT SELECT, INSERT ON TABLE ... TO service_role`のみ。
  `authenticated`には何もGRANTしない(0-1節の通り、REVOKEも実施済み)。
- `voice_notes`: `authenticated`に`SELECT/INSERT/UPDATE/DELETE`全てGRANTされたまま
  ([[PHOTO_KARTE_AUDIT_1]]で指摘した通り、RLSポリシーの新旧混在という別の問題も抱えている)。
- 本テーブルは**karte_imports方式(service_role限定)を採用**(B案、ユーザー既定方針)。

### 4-2. 確定するGRANT

```sql
-- 設計内容の記述例
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.brain_customer_photos
  TO service_role;
```

- `authenticated`/`anon`へのGRANTは**一切記述しない**(0-1節の通り、記述しなければ
  それだけで権限が付かないため、`REVOKE`文自体が不要)。
- `UPDATE`を含めるのは論理削除(`deleted_at`更新)のため。`DELETE`(物理削除)は
  [[PHOTO_KARTE_DB_DESIGN_1]]8-6節の方針上Phase1では使わない見込みだが、将来の運用削除に
  備えGRANT自体は付与しておく(実行するかどうかはAPI/運用側の判断であり、GRANTの有無とは
  別の話)。
- `riora_backup`ロールへの**明示的な**GRANT文は不要(0-1節の通り、`pg_default_acl`により
  新規テーブル作成時に自動的にSELECTが付与されるため)。ただし**このGRANT文が
  `service_role`のみを対象にしていても、実際にアクセス可能なロールは
  `service_role`だけではない**。詳細は末尾「riora_backupの権限について」節で訂正する。

### 4-3. staffが何をSELECT/INSERT/UPDATE/DELETEできるか

**DBレベルでは何もできない。** `authenticated`ロール(スタッフのログインセッションが
使うロール)には一切GRANTしないため、PostgRESTを直接叩いても
「permission denied for table brain_customer_photos」で拒否される。スタッフが実際に
写真を見る・登録する・消せるのは、すべて**service_roleを使うNext.js APIルート
(canAccessCustomer通過後)を経由した場合のみ**である([[PHOTO_KARTE_API_DESIGN_1]]で
設計済みの5エンドポイント)。

---

## 5. RLS(最重要)

### 5-1. 「RLSが緩くてもAPI側のcanAccessCustomerだけに依存する」を避ける設計

4節の通りGRANT自体が`authenticated`を排除しているため、**RLSポリシーが仮に存在しなくても
`authenticated`は最初からアクセスできない**。しかし本書では、[[PHOTO_KARTE_DB_DESIGN_1]]10節の
「ポリシーを一切作らない」案を採用せず、**`karte_imports`引き締め後と同じ
「`service_role`のみを対象にした明示的なポリシーを作る」方式に修正する**。

理由:
1. **自己文書化**: `pg_policies`を見た人が「このテーブルは意図的にservice_role限定である」
   と一目で分かる。「ポリシーが無い」状態は「まだRLS設計をしていない」のか
   「意図的にservice_role限定にした」のか外形的に区別がつかない。
2. **`karte_imports`の実例に合わせる**: ユーザー指示「既存パターンに合わせる」に従い、
   本番で実際に運用されている「引き締め後の最終形」をそのままテンプレートにする。
3. **GRANTとRLSの層を必ず一致させる**という`20260808000000_karte_imports_service_role_only.sql`
   のコメントにある教訓(「GRANTとRLSが食い違ったまま放置される構造的リスク」)を
   そのまま踏襲する。GRANT対象ロールとRLSポリシー対象ロールを常に同じ(`service_role`のみ)に
   揃えることで、将来どちらかだけを変更してしまうミスを構造的に防ぐ。

これにより、**「API側のcanAccessCustomerだけに依存する」設計にはならない**——
GRANT層とRLS層の両方が独立に`authenticated`を拒否する二重の壁になっており、
今回はさらに「その2つの壁が常に同じロール定義を参照する」ことでズレの発生自体を防いでいる。

### 5-2. 確定するRLS

```sql
-- 設計内容の記述例
ALTER TABLE public.brain_customer_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bcp_select" ON public.brain_customer_photos;
CREATE POLICY "bcp_select" ON public.brain_customer_photos
  FOR SELECT TO service_role USING (true);

DROP POLICY IF EXISTS "bcp_insert" ON public.brain_customer_photos;
CREATE POLICY "bcp_insert" ON public.brain_customer_photos
  FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "bcp_update" ON public.brain_customer_photos;
CREATE POLICY "bcp_update" ON public.brain_customer_photos
  FOR UPDATE TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "bcp_delete" ON public.brain_customer_photos;
CREATE POLICY "bcp_delete" ON public.brain_customer_photos
  FOR DELETE TO service_role USING (true);
```

- `USING(true)`/`WITH CHECK(true)`は「`service_role`は無条件に許可する」という意味であり、
  実質的には`service_role`が`BYPASSRLS`属性を持つため冗長ではある
  ([[PHOTO_KARTE_DB_DESIGN_1]]1-2節)。それでも明示的に書く理由は5-1節の自己文書化のため。
- **`authenticated`/`anon`向けのポリシーは一切作らない。** RLSが有効化されたテーブルで
  対象ロールに合致するポリシーが無い場合、そのロールからのアクセスは常に0件になる
  (default deny)。GRANTで既に拒否されているため二重の防御になる。

### 5-3. DB側で防げること・防げないこと

| 観点 | DBで防げるか |
|---|---|
| ログイン済みスタッフがPostgRESTを直接叩いて他人の顧客の写真を見る | **防げる**(GRANT+RLSの二重拒否) |
| Next.js APIのバグで`canAccessCustomer`のチェックを書き忘れる | **防げない**(service_roleは無条件許可のため、API層の実装ミスはDB層でカバーされない。これはB案を採る以上構造的に受け入れているトレードオフであり、[[PHOTO_KARTE_DB_DESIGN_1]]1-4節で既に合意済み) |
| 他店舗のstore_idを指定した写真の混入 | **一部防げる**(FK制約で存在しないstore_idは拒否されるが、store_id自体が正しいが「別の顧客の店舗と食い違う」ケースはAPI層の責務、[[PHOTO_KARTE_API_DESIGN_1]]5節) |

---

## 6. IDOR対策(API/DBの責務分離まとめ)

| 項目 | クライアントから指定可能か | 防御層 |
|---|---|---|
| `created_by` | **不可**。サーバーが`extractStaffFromRequest`の結果からのみ設定 | API層(構造的に受け付けない、[[PHOTO_KARTE_API_DESIGN_1]]5-1節) |
| `staff_id`相当の値全般 | **不可**。上記と同じ | API層 |
| `store_id` | **不可**。サーバーが`DEMO_STORE_ID`定数、または将来`staffBrainId`から解決した値を使用 | API層 |
| `customer_id` | URLパスの`[id]`のみが有効。ボディでの上書きは無視 | API層(`canAccessCustomer`) |
| 他人の`photo_id` | `DELETE`/`signed-url`取得時に`customer_id`所有権確認で拒否 | API層(`verifyOwnership`パターン、[[PHOTO_KARTE_API_DESIGN_1]]3節) |
| `store_id`/`customer_id`/`visit_id`間の複合的な整合性(例: 別顧客のvisit_idを指定) | **可能**(悪意ではなくAPI実装バグの場合に限る) | API層のみ([[PHOTO_KARTE_API_DESIGN_1]]2節手順7)。個別FKでは表現できず、DB制約は意図的に見送っている(13節)。service_role経由のためRLSも無関係 |
| 上記すべてのAPI層チェックが万一漏れた場合の最終防波堤 | — | **DB層(4節GRANT+5節RLS)。ただし5-3節の通りservice_role経由の抜け漏れそのものはDBでは防げない**(複合整合性チェックの抜け漏れも同様、13節) |

DBが直接防げるのは「`authenticated`ロールでの直接アクセス」のみであり、
「service_roleを使うAPIコードの実装ミス」はDBの責務ではなくコードレビュー・テストの責務である
([[PHOTO_KARTE_API_DESIGN_1]]14節「必要なテスト」に対応)。この責務分離を明確にしておくことが、
「RLSが緩くてもAPI側だけに依存する設計」と「RLS・GRANT・APIが役割分担された設計」の違いである。

---

## 7. created_by の確定内容(再掲)

[[PHOTO_KARTE_API_DESIGN_1]]5-1節でユーザーが確定した内容をFK制約として反映する。

```sql
created_by uuid REFERENCES public.brain_staff(id) ON DELETE SET NULL
```

- **`auth.users.id`(認証主体)ではなく`brain_staff.id`(Riora OS上のスタッフ主体)を
  FK先とする。** `auth.users`テーブルへの参照は一切持たせない。
- API実装時、`created_by`には`extractStaffFromRequest()`が返す`staffBrainId`
  (`authUserId`ではない)を使用する([[PHOTO_KARTE_API_DESIGN_1]]5-1節の手順3)。
- `ON DELETE SET NULL`により、`brain_staff`行が削除されても(実運用では論理削除
  `deleted_at`が使われるため物理削除は稀だが)写真記録自体は残る。

---

## 8. clientRequestId / 冪等性(DB制約でどこまで防げるか)

### 8-1. UNIQUE制約の追加とその理由

1節・3-2節で示した通り、**`storage_path`列にUNIQUE制約を追加する**
(`ux_brain_customer_photos_storage_path`)。これは[[PHOTO_KARTE_DB_DESIGN_1]]の
当初案にはなかった追加であり、本書で新たに導入する。

理由: 既存の`voice_notes`テーブルを調査したところ、`storage_path`列には**UNIQUE制約が
存在しない**ことを確認した(本番pg_indexesで確認済み、`voice_notes`の索引一覧に該当なし)。
`commitVoiceMemo`の冪等性は「アップロード前にDBを検索する」というアプリケーションコードの
チェックと、Storage自体の`upsert:false`という2つの機構だけに支えられており、**両者の間に
純粋な競合状態(race condition)が生じた場合、DB制約による最終防波堤が存在しない**。

具体的には、同一`clientRequestId`の2リクエストがほぼ同時に処理された場合:
1. 両方とも「DBにまだ行が無い」ことを確認する(冪等性チェックが空振り)
2. 両方がStorageへの`upsert:false`アップロードを試みる → 片方だけ成功、もう片方は衝突
3. 衝突した側は[[PHOTO_KARTE_API_DESIGN_1]]11節の「真の孤児判定」ロジックに入り、
   DBを再検索する → **まだ勝者側のINSERTが終わっていなければ、ここでも「見つからない」と
   誤判定し、`upsert:true`で勝者のアップロードを上書きしてしまう可能性がある**

この最後のケースを塞ぐのがDB側の`UNIQUE(storage_path)`制約である。**たとえStorageの状態が
一時的に競合しても、`brain_customer_photos`へのINSERTは1つの`storage_path`につき
1行しか許されないため、後発のINSERTは一意制約違反(23505)で必ず失敗する。** APIはこの
エラーコードを検知した場合、「自分は敗者だった」と判断し、`storage_path`で再検索して
勝者の行をそのまま返せばよい(冪等応答に合流させる)。

### 8-2. 各ケースの整理

| ケース | DB制約で防げるか | 実際の挙動 |
|---|---|---|
| 同一`clientRequestId`で正常に再送(前回成功済み) | ○ | `storage_path`検索でヒット→即座に冪等応答(INSERT自体発生しない) |
| 同一`clientRequestId`で2リクエストが真に同時実行 | ○(UNIQUE制約が最終防波堤) | 片方がINSERT成功、もう片方は23505エラー→再検索して合流 |
| Storageだけ存在しDBに行がない(真の孤児) | 一部(DBは「行が無い」ことしか示せない。孤児と確定するのはAPI層の責務) | [[PHOTO_KARTE_API_DESIGN_1]]11節の`upsert:true`救済ロジックで対応。UNIQUE制約はこの救済ロジックが万一別の同時リクエストと競合した場合の保険として機能する |
| DB INSERT失敗後の再送 | ○(UNIQUE制約により重複行は作られない) | 失敗時はStorageに孤児が残るのみでDB行は無い状態のため、再送は「孤児判定→上書き→INSERT」を経て初めて成功する。UNIQUE制約により、万一この過程で二重にINSERTが試みられても片方は確実に弾かれる |
| 別customerで同じ`clientRequestId`が送られた場合 | **DB制約は不要**(そもそも衝突しない) | Storageパスに`customer_id`が含まれるため([[PHOTO_KARTE_API_DESIGN_1]]10節)、異なる顧客であれば`storage_path`自体が異なる文字列になり、`UNIQUE(storage_path)`にも抵触しない。顧客をまたいだ`clientRequestId`の再利用は設計上問題にならない |

### 8-3. DB制約だけでは防げないこと

- 「同じ`clientRequestId`で、意図的に異なる画像ファイルを2回送る」というクライアント側の
  契約違反は、DBもStorageも検知できない(2回目は1回目と同じ`storage_path`に
  `upsert:false`で弾かれ、冪等応答として1回目の内容が返るだけであり、エラーにはならない)。
  これはセキュリティ上の問題ではなく(他人のデータへの越境ではない)、
  クライアント実装の責務として扱う。
- `visit_id`が指定されている場合に、その`visit_id`の`customer_id`が本当に
  URLの`customer_id`と一致しているかは、**DBのCHECK制約では表現できない**
  (PostgresのCHECK制約は他テーブルを参照できないため)。この整合性は
  [[PHOTO_KARTE_API_DESIGN_1]]2節の処理フロー手順7(API層での事前確認)に委ねる。
  トリガーによるDB側強制も選択肢としてはあり得るが、既存コードベースに同種の
  クロステーブル整合性をトリガーで強制している前例が無く、今回も見送る
  (過剰設計を避ける方針、[[PHOTO_KARTE_DB_DESIGN_1]]と同じ判断基準)。

---

## 9. migrationの実行順序

`karte_imports`の実例(1ファイル内で完結)に倣い、**テーブル作成からGRANTまでを
1本のmigrationファイルに収める**方針を推奨する(karte_importsのように「緩い状態→引き締め」の
2段階を踏む必要はない。0節の通り最終形を最初から採用するため)。

ファイル内の記述順序(依存関係に基づく):

```
1. CREATE TABLE(1節)              -- 列定義・PK・FK・CHECK・DEFAULTをすべて含む
2. UNIQUE制約(1節・8節)            -- CREATE TABLE内のCONSTRAINT句として同時定義可能
3. CREATE INDEX(3節)              -- テーブル存在後でないと作成不可
4. ALTER TABLE ... ENABLE ROW LEVEL SECURITY(5節)
5. CREATE POLICY × 4(5節)         -- RLS有効化後でないと無意味ではないが、
                                       慣例上ENABLE RLSの直後に置く(karte_importsと同順)
6. GRANT(4節)                     -- 最後に置く(karte_importsと同順、
                                       「テーブル・RLSが整った状態に権限を与える」という意味付け)
```

Storage bucket(`customer-photos`)の作成は[[PHOTO_KARTE_DB_DESIGN_1]]8-7節の通り
**Supabase Dashboard上の操作になる見込みであり、`supabase/migrations/`のSQL migrationとは
別の手順として文書化する**(voice-notesと同じ運用)。DB migrationファイルの実行順序には含めない。

---

## 10. 既存migrationとの衝突確認

Supabase MCP(読み取り専用)で本番を直接確認した結果:

- テーブル名`brain_customer_photos`: 本番に存在しない(確認済み)
- インデックス名`%customer_photos%`: 本番に存在しない(確認済み)
- 制約名`%customer_photos%`: 本番に存在しない(確認済み)
- ポリシー名`bcp_%`: 本番に存在しない(確認済み)
- migrationファイル内の文字列検索(`brain_customer_photos`/`bcp_select`/`bcp_insert`/
  `customer_photos`): `supabase/migrations/`内に一致するファイルなし(確認済み)

**衝突は確認されなかった。** 命名(`brain_customer_photos`、`bcp_*`、
`idx_brain_customer_photos_*`、`ux_brain_customer_photos_storage_path`)はそのまま
使用して問題ない。

---

## 11. CREATE TABLE IF NOT EXISTSの再検討(2026-09-02、ユーザーレビューを反映)

### 結論: `CREATE TABLE`(IF NOT EXISTS無し)に変更する

`karte_imports`は`CREATE TABLE IF NOT EXISTS`を使っていたが、これは既存の慣行を
無条件に踏襲すべき理由にはならない。10節の通り`brain_customer_photos`という名前は
本番・migrationファイルのいずれにも存在しないことを確認済みであり、これは
**「同名テーブルが既に存在する」という状況そのものが起こり得ないことを事前に検証済み**
であることを意味する。この前提のもとでは:

- `IF NOT EXISTS`が実際に効く場面は「調査時点では存在しなかったはずのテーブルが、
  何らかの理由(手動操作・別ブランチの並行作業・命名の偶然の一致等)で
  適用時点までに存在してしまっていた」という**異常事態のみ**。
- その場合、`IF NOT EXISTS`は該当のCREATE TABLE文を黙って`skip`し、migrationは
  「成功」として完了する。しかし後続のCREATE INDEX/ALTER TABLE/CREATE POLICY/GRANTは、
  **中身が想定と異なるかもしれない既存テーブル**に対して実行されてしまう
  (列が無くてエラーになるか、最悪の場合は列名がたまたま一致していて
  意図しないデータ構造に書き込みが始まる)。
- `IF NOT EXISTS`を外せば、この異常事態は**CREATE TABLE文そのものがエラーで停止する**
  ことで即座に検知でき、後続の処理が誤った前提で進むことを防げる。

一方、`CREATE INDEX IF NOT EXISTS`・`DROP POLICY IF EXISTS`は据え置く。これらは
「再実行時に同名オブジェクトがあっても安全に収束させる」という異なる目的
(冪等性)のためのものであり、テーブル本体と違い誤った既存定義を静かに見逃す
リスクが実質的にない(インデックス・ポリシーは定義を見れば内容が一目で分かり、
かつ再作成のコストが低い)。karte_importsを含む既存プロジェクト全体もこの2つは
一貫してIF EXISTS/IF NOT EXISTSを使っており、今回はテーブル本体のみを
方針変更の対象とした。

migrationファイル(`20260902000000_brain_customer_photos.sql`)は既に修正済み。

---

## 12. riora_backupの権限について(2026-09-02、ユーザーレビューを反映・重要な訂正)

### 実測結果

Supabase MCP経由で本番を直接確認した:

```
pg_roles:
  riora_backup   : rolsuper=false, rolbypassrls=true,  rolcanlogin=true
  service_role   : rolsuper=false, rolbypassrls=true,  rolcanlogin=false
  authenticated  : rolsuper=false, rolbypassrls=false, rolcanlogin=false
  postgres       : rolsuper=false, rolbypassrls=true,  rolcanlogin=true

既存テーブルのowner: brain_customers/brain_visits/karte_imports/voice_notes
  いずれも owner = postgres

既存テーブルへのriora_backup権限(information_schema.role_table_grants実測):
  brain_customers: riora_backup に SELECT が付与されている
  brain_visits   : riora_backup に SELECT が付与されている
  karte_imports  : riora_backup に SELECT が付与されている
  voice_notes    : riora_backup に SELECT が付与されている
  (いずれもSELECTのみ。INSERT/UPDATE/DELETEは付与されていない)
```

### 4つの問いへの回答

1. **実際にriora_backupへSELECTが付与されるのか** → **付与される。** 既存の
   `brain_customers`/`brain_visits`/`karte_imports`/`voice_notes`全てで実測確認した
   通り、`pg_default_acl`(0-1節)により、`postgres`ロールが作成する`public`スキーマの
   新規テーブルには`riora_backup`への`SELECT`が自動付与される。`brain_customer_photos`も
   同じ条件(postgres所有・publicスキーマ)で作成されるため、**同様にSELECTが
   自動付与される見込み**。
2. **その場合、RLSによってriora_backupのSELECTは拒否されるのか** → **拒否されない。**
   `riora_backup`は`rolbypassrls=true`のため、RLSポリシーの内容に関わらず
   (ポリシーが1件も存在しなくても)常にRLSの評価自体をスキップしてアクセスできる。
3. **riora_backupがBYPASSRLS等を持っていないか** → **持っている**(`rolbypassrls=true`、
   `service_role`や`postgres`と同じ)。
4. **バックアップ用途としてbrain_customer_photosをriora_backupが読める必要があるのか** →
   **必要と判断する。** 既存の機微性の高いテーブル(`karte_imports`=カルテ原文、
   `voice_notes`=接客音声の書き起こし)も含め、プロジェクト全体で一貫して
   `riora_backup`はバックアップ対象として読める設計になっている
   ([[project_backup_recovery_design]]と整合)。写真カルテだけをこの対象から
   除外する特段の理由はなく、除外するにはbrain_customer_photosの`GRANT`を
   `pg_default_acl`の適用対象外にする追加作業(所有者を変える等)が必要になり、
   既存の一貫した運用から意図的に逸脱することになる。**除外は推奨しない。**

### 設計書・migrationの訂正

「service_roleのみがアクセス可能」という表現は**不正確**だった。正しくは:

> **書き込み(INSERT/UPDATE/DELETE)はservice_role限定。読み取り(SELECT)は
> service_role(アプリAPI用)+riora_backup(バックアップ専用ロール、
> pg_default_aclにより自動付与・rolbypassrls=trueのためRLSも無関係に読み取り可能)の
> 2ロールが可能。authenticated/anonはいずれのロールでも一切アクセス不可。**

- 本書0節・4節・5節、および`20260902000000_brain_customer_photos.sql`の該当コメントを
  この表現に訂正済み。
- **これはセキュリティ上の後退ではない。** `riora_backup`は既存の最も機微性の高い
  テーブル群と同一の扱いを受けているだけであり、`authenticated`(ログイン済み
  スタッフのセッション)からのアクセスを防ぐという本来の目的(IDOR防止、
  [[PHOTO_KARTE_API_DESIGN_1]]5節)には一切影響しない。**「RLSが緩くても
  API側のcanAccessCustomerだけに依存する設計にしない」という要件も引き続き
  満たされている**(5-3節「DB側で防げること」は`authenticated`経路の話であり、
  `riora_backup`は運用上信頼された別カテゴリのロールであるため対象外)。

---

## 13. store_id / customer_id / visit_id / created_byの整合性(2026-09-02、ユーザーレビューを反映)

### 問題の所在

現在の設計は4本の個別FKのみで構成されている:

```
store_id    → brain_stores.id
customer_id → brain_customers.id
visit_id    → brain_visits.id
created_by  → brain_staff.id
```

個別FKは「参照先が実在すること」しか保証しない。「`customer_id`が指す顧客の
`store_id`と、この写真行自身の`store_id`が一致していること」のような**複合的な
整合性**は、個別FKだけでは表現できない。

### 既存テーブルの実例調査(brain_skin_records)

`customer_id`と`visit_id`を同時に持つ既存テーブルとして最も近い前例である
`brain_skin_records`のFK定義を再確認した:

```
brain_skin_records.customer_id → brain_customers.id  (ON DELETE CASCADE)
brain_skin_records.visit_id    → brain_visits.id     (ON DELETE CASCADE, UNIQUE)
```

**複合FKは存在しない。** `brain_skin_records`も本テーブルと全く同じ構造上の課題
(理論上は「customer_idとvisit_idが別顧客」を指せてしまう)を抱えているが、
既存の実装チームはこれを個別FKのみで運用し、複合FKや検証トリガーを追加していない。

### 3つの問いへの回答

1. **DB制約で防ぐべきか** → 技術的には可能(後述)だが、**今回は見送るべき**と判断する。
2. **API層で防ぐべきか** → **はい。** [[PHOTO_KARTE_API_DESIGN_1]]2節の処理フロー手順7
   (「`visitId`が指定されている場合、`brain_visits`に存在し`customer_id`が一致するか
   確認」)が既にこれを担っている。写真という新機能固有の追加対応は不要。
3. **現状はAPI層で十分と判断してよいか** → **はい、以下の理由で妥当と判断する**

### 判断理由

- **`brain_skin_records`という直接の前例が、全く同じ課題をAPI層(book書き込み経路)に
  委ねる設計を既に採用している。** 今回だけ異なる基準(DB制約での強制)を持ち込む
  必然性がない。
- **現状は実質単一店舗運用**([[PHOTO_KARTE_DB_DESIGN_1]]2節)であり、`store_id`は
  常に同一の固定値。「店舗をまたいだ不整合」は理論上のリスクであって、
  現在のデータでは発生しようがない。
- **複合FKを実装するには、参照先である既存の`brain_customers`/`brain_visits`/
  `brain_staff`テーブルに`UNIQUE(id, store_id)`等の複合一意制約を追加する必要が
  あり、これは本migrationのスコープ(新規テーブル1つ)を超えて既存の稼働中テーブルの
  スキーマを変更することになる。** 今回のユーザー指示は「migrationファイルの
  作成のみ」かつ対象は`brain_customer_photos`であり、既存テーブルへの変更は
  別途明示的な指示がない限り着手すべきではない([[feedback_scoped_approval_discipline]]、
  CLAUDE.md「直前の指示で明示的に列挙されていないファイルの変更を行わない」)。
- **service_role経由のAPIアクセスである以上、RLSはこの種の複合整合性を守れない**
  (service_roleはRLSをバイパスするため)。この点はユーザー指摘の通り正しい認識であり、
  だからこそ「DBが守れない部分はAPI層が確実に守る」という責務分担を明文化する
  意味がある(6節のIDOR対策表に追記する)。

### 将来再検討する場合の選択肢(今回は未実装)

複合FKを追加する場合は、例えば`brain_customers`に
`UNIQUE (id, store_id)`を追加した上で、`brain_customer_photos`側に
`FOREIGN KEY (customer_id, store_id) REFERENCES brain_customers (id, store_id)`を
追加する、という形になる。`visit_id`についても同様に`brain_visits`へ
`UNIQUE (id, customer_id)`を追加すれば
`FOREIGN KEY (visit_id, customer_id) REFERENCES brain_visits (id, customer_id)`が
可能になる。**これらはいずれも既存テーブルへのスキーマ変更を伴うため、
今回のPhase1スコープには含めない。** マルチストア化(store_idの実効化、
[[PHOTO_KARTE_DB_DESIGN_1]]2節)に着手するタイミングで、`brain_skin_records`を
含めた既存テーブル全体の方針として改めて検討するのが適切と考える。

---

## Migration実装前チェック

| 項目 | 状態 | 備考 |
|---|---|---|
| DB設計 | **確定** | [[PHOTO_KARTE_DB_DESIGN_1]]。本書3節でインデックス方針のみ一部修正(4本→3本+UNIQUE制約) |
| API設計 | **確定** | [[PHOTO_KARTE_API_DESIGN_1]] |
| FK | **確定** | `store_id→brain_stores`, `customer_id→brain_customers`, `visit_id→brain_visits`, `created_by→brain_staff`。すべてON DELETE方針込みで確定(1節) |
| RLS | **確定** | `service_role`限定ポリシーを明示的に作成する方式(5節)。karte_imports引き締め後の実例に整合。ただし`riora_backup`はRLSをバイパスするため対象外(12節で訂正済み) |
| GRANT | **確定** | 明示的なGRANT文は`service_role`のみ、`authenticated`への記述なし(4節)。`riora_backup`は`pg_default_acl`により自動でSELECTのみ付与される点を12節で明記済み(意図的・既存テーブルと同一の扱い) |
| 個別FKの複合整合性(store_id/customer_id/visit_id/created_by) | **確定(API層で担保、DB制約は見送り)** | `brain_skin_records`の前例に整合。13節参照 |
| Index | **確定** | 3本+UNIQUE制約1本(3節)。DB設計書からの縮小を含め確定 |
| 冪等性 | **確定** | `storage_path`のUNIQUE制約+API層の孤児救済ロジック([[PHOTO_KARTE_API_DESIGN_1]]11節)の組み合わせで確定(8節) |
| Storage path | **確定** | `{store_id}/{customer_id}/{clientRequestId}.webp`(2節) |
| 認証/認可 | **確定** | `extractStaffFromRequest`+`canAccessCustomer`+`verifyOwnership`パターン踏襲、`created_by`は`brain_staff.id`(6・7節) |
| Storage bucket自体の作成手順 | **要確認** | Dashboard操作の具体的な設定値(`file_size_limit`、許可MIME)は[[PHOTO_KARTE_DB_DESIGN_1]]8-1節の案のままで確定してよいか未確認 |
| `MAX_PHOTO_UPLOAD_BYTES`の具体値 | **要確認** | [[PHOTO_KARTE_API_DESIGN_1]]総括で保留のまま(5MB案) |
| `body_part`初期語彙の最終リスト | **要確認** | [[PHOTO_KARTE_DB_DESIGN_1]]6節の案のまま最終確定していない |
| Supabase契約プランのStorage容量上限 | **要確認** | [[PHOTO_KARTE_DB_DESIGN_1]]8-7節から継続未確認 |
| 画像処理ライブラリ選定 | **要確認** | DB/API/migration設計とは独立だが、Phase1実装全体の前提として未確定 |

### 判断

FK・RLS・GRANT・Index・冪等性・Storage path・認証認可という**migrationファイルの内容そのものを
左右する項目はすべて確定した**。残る「要確認」項目(Storage bucketの設定値、
アップロード上限バイト数、body_part語彙、Storage容量、画像処理ライブラリ)は、
いずれも**migrationファイル(テーブル定義・RLS・GRANT)の内容には影響しない**
(bucket設定はDashboard操作、上限バイト数はAPI側の定数、body_part語彙はCHECK制約を
設けない設計のためテーブル定義に影響しない)。

**したがって、migrationファイルの実装(作成)自体は上記の設計内容で進めてよい状態にある。**
ただし、実際にファイルを作成・適用してよいかは別途の明示的な承認が必要であり、
本書はその承認を求めるものではなく、承認判断のための設計内容の提示に留まる。

人間が確認すべき事項として残っているのは、**上記の「要確認」5項目のうち、
少なくともStorage bucketの設定値とアップロード上限バイト数の2つは、migrationファイルとは
別に必要になるStorage側の設定作業(Dashboard操作)に直結するため、migration実装と同じ
タイミングで確定させておくことを推奨する**という点である。テーブル定義自体の実装を
妨げるものではない。
