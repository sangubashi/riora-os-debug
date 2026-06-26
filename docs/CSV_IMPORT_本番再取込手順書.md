# CSV Import 本番再取込手順書

作成日: 2026-06-25(Pass D拡張版)
対象: `csvImportPipeline.ts`(Pass C: メニュー名名寄せ改善 / Pass D: CSV Import完成 適用後)
運用担当者向け。Supabase SQL Editorでの操作は不要(すべてアプリのAPI/スクリプト経由)。

## 0. 前提・スコープ

本手順は**今後のCSV取込(新規アップロード・再アップロード)**を安全に行うための運用手順である。

**本手順を実行しても、以下は変更されない(変更してはならない・禁止事項)**:
- 既存`brain_visits`の削除・既存行の遡及的な再解決
- 既存`brain_customers`の削除(同姓同名の重複レコードも含め、削除は一切行わない)
- 既存`brain_reservations`相当データの削除(※`brain_reservations`というテーブルは存在しない。本番に存在するのは`brain_bookings`(0件・未使用)と、別系統の旧スキーマ`reservations`(Phase1スタッフアプリ用・本CSV Importとは無関係)。§6.3で詳述)
- `brain_menus`マスターデータの直接変更

→ 現在すでに本番に存在する**「imported_other 39件」「同姓同名重複6組12件」は本手順では解消されない**(§7「既知の残課題」)。

## 1. 本番データ影響調査(事前に必読)

| テーブル | 本CSV Importとの関係 | 本手順での扱い |
|---|---|---|
| `brain_visits`(39件) | 書込先(INSERT/UPDATE)。**DELETEは一切発生しない** | 新規行のINSERT、または`source='staff_input'`行のUPDATE(`reconcile()`)のみ。既にCSV取込済み(`source='salonboard_import'`/`'reconciled'`)の行は冪等スキップされ**変更されない** |
| `brain_customers`(40件) | 書込先(INSERT)。**DELETEは一切発生しない** | 新規顧客のINSERTのみ。既存顧客のUPDATEは`prefecture`/`city`等の空欄補完のみ(`patchFromImport`・既存の手入力値は上書きしない) |
| `brain_bookings`(0件) | **本パイプラインは一切参照しない**(読込・書込ともになし) | 影響なし |
| `brain_reservations` | **存在しない**(本番Supabaseに当該テーブルは無い) | 影響なし(指示文の対象テーブルが見つからないため、念のため`brain_bookings`として扱った) |
| 旧`reservations`(別スキーマ・140件超) | Phase1スタッフアプリ専用テーブル。CSV Importは`brain_*`テーブルのみを扱うため**無関係** | 影響なし |
| `brain_ops_logs` | 書込先(INSERT)。取込結果の記録のみ | 影響なし(追記のみ) |
| `brain_staff.name_aliases` | `POST /api/admin/staff-aliases`で更新(JSONB配列への追記) | 既存スタッフ行のUPDATEのみ。スタッフの新規作成・削除はしない |

**結論: 本パイプラインの通常実行で既存データが破壊されるリスクは無い**(DELETE文を発行する経路がコード上存在しない)。唯一のリスクは「データの破壊」ではなく「**重複データの新規作成**」(§7.1)である。

## 2. Dry Run手順(必須・スキップ禁止)

```
POST /api/admin/csv/dry-run
```
(または`buildDryRunResult()`を直接呼ぶ場合は`scripts/dry_run_csv_check.ts`を参考に同等の呼び出しを行う)

レスポンスの`qualityReport`を**必ず確認する**。`reviewDecisions`を指定せずに直接§4のImportへ進んではならない(過去にこれを怠ったため、本番で同姓同名6組12件の重複顧客が作られた。§7.1参照)。

`qualityReport.warnings`の各`type`への対応:

| `type` | severity | 対応 |
|---|---|---|
| `unresolved_staff` | error | **必須対応**。`unresolvedStaff`一覧の各スタッフ名について、`POST /api/admin/staff-aliases`で正しい`brain_staff.id`へ紐付ける。**対応しない場合、該当行は来店データとして取り込まれず黙ってスキップされる**(取込件数が静かに減る。実例: 異体字「外館」vs「外舘」で全行の38%が脱落した) |
| `duplicate_customer_name` | warn | `needsReview`一覧を1件ずつ確認し、`reviewDecisions`に`'merge'`(既存顧客と同一人物)または`'new'`(別人)を**明示的に**指定する |
| `needs_review_pending` | warn | 上記と同じ対応(対象行は同じ) |
| `menu_unmatched` | info | 対応不要(想定内)。`menuResolution.entries`で生メニュー名を確認できる |

`qualityReport.rates`(解決率)も記録しておく(§5の差分確認で使用):
`customerResolutionRate`(会員番号一致率)・`staffResolutionRate`・`menuResolutionRate`・`importedOtherRate`・`errorCount`・`skippedCount`

`score`が`poor`/`fair`の場合は、対応を行うまで**§4(Import実行)に進まない**こと。

## 3. Rollback手順(最重要)

### 3.1 Import実行**前**のロールバック(推奨・常に可能)

Dry Run(§2)はDBに一切書き込まない(`buildDryRunResult`は読み取りのみ)。**品質レポートを見て「取込しない」と判断するのが最も安全なロールバックである**。問題があれば単にImportを実行しないこと。

### 3.2 Import実行**後**のロールバック(制約あり・正直な開示)

**本パイプラインには「インポートを取り消す」機能は存在せず、新規に作成した`brain_customers`/`brain_visits`行を削除する手段は提供しない**(禁止事項により削除コードは実装していない)。Import実行後に誤りに気づいた場合の対応は以下のみ:

| 状況 | 対応 |
|---|---|
| `menu_id`/`staff_id`が誤っていた(行自体は正しい人物・日付) | 当該`brain_visits`行を`visitRepo.reconcile()`系の仕組みでUPDATE可能(削除不要)。ただし既存のCSV取込済み行(`source='salonboard_import'`)への再UPDATE経路は現状未実装(§7.2) |
| 誤って重複顧客を作成した(同一人物が別レコードに) | **削除はできない**(禁止事項)。`brain_customers`に重複が残ったまま運用するか、別途ユーザー承認のもとで統合スクリプト(削除を伴う)を作る以外に解消手段が無い |
| 全く誤ったCSVファイルを取り込んでしまった | **行レベルの取消は不可能**。これが「Dry Runを必ず先に実行する」ことを最重要事項としている理由である(§2) |

→ **結論: 事後ロールバックは限定的(menu_id/staff_id訂正のみ可能・顧客/来店の取消は不可能)。事前のDry Run確認が唯一の確実なリスク回避策。**

## 4. 再取込手順(Import実行)

```
POST /api/admin/csv/import
```

`unresolvedStaff`が解消され、`needsReview`の各行について`reviewDecisions`を明示的に決定した上で実行する(`reviewDecisions`に該当行の決定をすべて含める)。

**同一CSVの再アップロードは安全**(冪等): 既に取り込まれた行(`source='salonboard_import'`/`'reconciled'`・同一`customer_id`+`visit_date`)は自動的にスキップされ、重複作成されない。

レスポンス(`ImportReport`)の確認項目:
- `unresolvedStaffCount === 0`
- `qualityReport.rates`: §2で記録した`dry-run`時点の値と一致するはず(一致しない場合は処理中にデータが変化した可能性があり要調査)
- `qualityReport.duplicateCustomerNames`: 空配列であることが望ましい

## 5. 差分確認手順(事後検証)

```
npx tsx scripts/csv_import_health_check.ts [storeId]
```

§1で記録した実行前の値と比較する:
- [ ] `brain_customers`総数の増分が`ImportReport.newCustomers`と一致する
- [ ] 同姓同名重複が**増えていない**(既存の重複は解消されないが、新たな重複を作っていないことを確認)
- [ ] `imported_other`件数・割合が想定どおり(増分が`menuResolution.fallbackOther`+`unresolved`と一致)
- [ ] `brain_ops_logs`に取込ログが1件追加されている

## 6. 補足: 本番データ影響調査の詳細

### 6.1 削除コードの不存在確認

`csvImportPipeline.ts`・各Repository実装(`CustomerRepo.ts`/`VisitRepo.ts`)を確認した結果、`DELETE`に相当するメソッド(`delete`/`remove`等)はCSV Import経路上に**実装されていない**。誤操作によるデータ削除は構造的に発生しない。

### 6.2 UPDATE範囲の確認

UPDATEが発生するのは以下のみ:
- `brain_visits`: `source='staff_input'`の既存行を`reconcile()`でCSVの内容に上書き(設計どおり・B案ハイブリッドの突合)
- `brain_customers`: `prefecture`/`city`/`age_group`/`first_visit_date`の**空欄のみ**補完(`patchFromImport`・既存の手入力値は上書きしない)
- `brain_staff.name_aliases`: 運用者が明示的に`POST /api/admin/staff-aliases`を呼んだ場合のみ追記

### 6.3 `brain_reservations`について

指示文に記載された`brain_reservations`は調査の結果**本番Supabaseに存在しないテーブル**であることを確認した(`Could not find the table 'public.brain_reservations'`)。類似名のテーブルは2つ存在する:
- `brain_bookings`(0件・brain系の予約テーブル。CSV Importは参照しない)
- `reservations`(別スキーマ・Phase1スタッフアプリ専用・140件超。CSV Import(`brain_*`系)とは完全に独立しており影響なし)

念のため両テーブルともCSV Importコードから一切参照されていないことをコード調査で確認済み(影響範囲ゼロ)。

## 7. 既知の残課題(本手順では対応しない・将来のユーザー承認が必要)

### 7.1 既存の同姓同名重複顧客(6組12件・2026-06-25時点)

```
深堀 直美 / 崔 京子 / 井口 悠 / 大熊 萌 / 松下 直樹 / 鈴木 雅子(各2件)
```

過去の本番取込が`reviewDecisions: {}`を直接指定する開発用スクリプトで実行されたため、§2のレビュー手順を経ずに同一人物が複数回来店した際にすべて`new`扱いとなった。解消には重複ペアの一方を削除し関連する`brain_visits.customer_id`を付け替える必要があるが、**`brain_customers`の削除は本タスクの禁止事項に該当するため実施していない**。

### 7.2 既存brain_visits 39件の`imported_other`(Pass C適用後も変化なし)

既に取り込まれた行は再取込しても冪等スキップされ、`menu_id`は書き換わらない。改善した解決結果を既存39件へ反映したい場合は、`menu_id`のみを更新する新規の安全なバックフィル処理(削除や金額変更を伴わない)を別途実装・実行する必要があるが、本番データへのUPDATEを伴うため本タスクでは実行していない。

### 7.3 `brain_menus`マスタの不足

実際の施術(フェイシャルエステ/保湿パック/美白美容液導入/小顔矯正等)に対応する`brain_menus`行が無いため、Pass Cの名寄せ改善でも一定割合は`imported_other`に残る(詳細は完成レポート§3の分類A/B/C参照)。マスタ拡充は「マスターデータ直接変更禁止」の対象のため本タスクでは行っていない。

## 8. チェックリスト(再取込実行者向け)

- [ ] §1の影響調査内容を理解した(削除は発生しない・唯一のリスクは重複顧客作成)
- [ ] `csv_import_health_check.ts`で事前状態を記録した(§5の比較用)
- [ ] Dry Run(§2)を実行し`qualityReport`を確認した
- [ ] `unresolved_staff`が0件、または全件`staff-aliases`へ紐付け済み
- [ ] `duplicate_customer_name`/`needs_review_pending`の対象行すべてに`reviewDecisions`を明示指定した
- [ ] 問題があればImportを実行しない(§3.1・最も確実なロールバック)
- [ ] Import実行後、`ImportReport.unresolvedStaffCount === 0`を確認した
- [ ] 差分確認(§5)を実施し、重複顧客が増えていないことを確認した
