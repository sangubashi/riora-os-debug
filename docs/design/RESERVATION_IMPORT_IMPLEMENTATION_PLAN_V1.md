# 予約CSV取込 実装計画書 v1(RESERVATION_IMPORT_IMPLEMENTATION_PLAN_V1)

- 作成: Phase RES-4(調査・計画のみ・実装禁止・DB変更禁止)
- 正典: `docs/design/RESERVATION_IMPORT_V1.md`(RES-2)・RES-3調査結果(未決定事項6件の確定)
- 位置づけ: **実装計画のみ。コード変更・DDL適用は行わない。**

---

## 1. 影響ファイル一覧(新規+修正の全体像)

```
新規:
  src/lib/import/reservationCsvParser.ts        … CSVパース(59列ヘッダー解決・日時結合)
  src/lib/import/reservationStatusMapper.ts     … ステータス変換テーブル
  src/repositories/interfaces.ts(修正)          … IReservationRepo型定義を追加
  src/repositories/supabase/ReservationRepo.ts  … Repository実装
  app/lib/repos.ts(修正)                        … reservationRepoをRepos型・getRepos()へ追加
  app/api/admin/csv/reservation-dry-run/route.ts … 予約CSV専用Dry Run API(新規エンドポイント)
  app/api/admin/csv/reservation-import/route.ts  … 予約CSV専用Import API(新規エンドポイント)
  src/components/admin/csv-import/types.ts(修正) … 予約CSV用のValidationResult/ImportReport型拡張

修正(既存流用・軽微変更):
  src/lib/import/staffResolver.ts               … 変更なしで流用。呼び出し側でuser_idマッピング追加
  src/lib/import/customerMatcher.ts             … 変更なしで流用(氏名一致のみ・電話番号ロジック追加なし)
  src/lib/import/csvTypeDetector.ts             … 'reservation'検出時のinfoMessageを更新
                                                    (「次フェーズで対応予定」→実際に対応済みの案内へ)
  src/components/admin/csv-import/CsvImportScreen.tsx … csvType==='reservation'時の実行ボタン
                                                          gate解除・新エンドポイント呼び分け
  src/repositories/supabase/OccupancyRepo.ts    … hourlyVisits/occupancyTrendメソッド追加
  app/api/admin/occupancy/route.ts              … available:falseの分岐をreservationsベースの実値へ差し替え

テスト(新規):
  tests/lib/import/reservationCsvParser.test.ts
  tests/repositories/supabase/ReservationRepo.test.ts
  tests/api/admin-csv-reservation-import.test.ts
  tests/api/occupancy-hourly.test.ts
```

---

## 2. 新規作成ファイル一覧(詳細)

| ファイル | 役割 |
|---|---|
| `src/lib/import/reservationCsvParser.ts` | 59列ヘッダーの列名ゆらぎ吸収・`来店日`+`開始時間`→JST timestamptz結合・`所要時間`等の数値変換・`このサロンに行くのは初めてですか？`→`is_new_customer`変換(RES-3確定マッピング) |
| `src/lib/import/reservationStatusMapper.ts` | `受付待ち→confirmed` `会計済み→completed` `お客様キャンセル→cancelled`(RES-2 §2確定ルール)。未知の値はスキップ+エラー行として記録 |
| `src/repositories/supabase/ReservationRepo.ts` | `reservations`テーブルへのUPSERT実装(§7参照) |
| `app/api/admin/csv/reservation-dry-run/route.ts` | 予約CSV専用のDry Run API(既存`csv/dry-run`とは別エンドポイント。§8で共存方針を詳述) |
| `app/api/admin/csv/reservation-import/route.ts` | 予約CSV専用のImport実行API |

---

## 3. 修正ファイル一覧(詳細)

| ファイル | 修正内容 |
|---|---|
| `src/repositories/interfaces.ts` | `IReservationRepo`インターフェース追加(既存`IVisitRepo`等と同水準) |
| `app/lib/repos.ts` | `Repos`型へ`reservationRepo: IReservationRepo`追加、`getRepos()`に`new ReservationRepo(supabase)`追加 |
| `src/lib/import/csvTypeDetector.ts` | `infoMessage`文言の更新のみ(ロジック=`RESERVATION_SIGNALS`判定は変更不要) |
| `src/components/admin/csv-import/CsvImportScreen.tsx` | L174の`if (validation.csvType !== 'detail') return false`ゲートを分岐させ、`reservation`時は新API(`reservation-dry-run`/`reservation-import`)へ振り分け |
| `src/components/admin/csv-import/types.ts` | 予約CSV固有のプレビュー列(開始時間・終了時間・所要時間・ステータス等)を表示するための型追加 |
| `src/repositories/supabase/OccupancyRepo.ts` | `hourlyVisits(storeId, date)`・`occupancyTrend(storeId, from, to)`メソッド追加 |
| `app/api/admin/occupancy/route.ts` | `hourlyVisits`/`occupancyTrend`の`available:false`固定レスポンスを、`reservations`にデータが存在する場合は実値を返す分岐へ変更 |

**DBスキーマ・DDLファイルへの修正は本計画に含まない**(RES-3確定方針により「予約番号」列追加は後回し=Bランク、暫定複合キーで運用開始するため)。

---

## 4. Repository層構成

既存パターン(`ICustomerRepo`/`IVisitRepo`等)に完全準拠する。

```ts
// src/repositories/interfaces.ts へ追加
export interface ReservationUpsertInput {
  staffId: UUID;              // profiles.id(brain_staff.user_id経由で解決済みの値)
  brainCustomerId: UUID | null;
  menu: string;                // text直接格納(menuResolver不要・RES-2 §5確定)
  price: number;
  scheduledAt: string;         // ISO timestamptz
  durationMinutes: number;
  status: 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
  isNewCustomer: boolean;
  notes: string | null;
}

export interface IReservationRepo {
  /** 暫定複合キー(staff_id, scheduled_at, brain_customer_id)で既存行を検索する(RES-3確定の暫定UPSERTキー)。 */
  findByNaturalKey(staffId: UUID, scheduledAt: string, brainCustomerId: UUID | null): Promise<{ id: UUID } | null>;
  /** 新規作成。 */
  create(input: ReservationUpsertInput): Promise<{ id: UUID }>;
  /** 既存行の更新(再取込時の冪等更新)。 */
  update(id: UUID, input: ReservationUpsertInput): Promise<void>;
}
```

`ReservationRepo`(実装クラス)は`OccupancyRepo.ts`と同様、Supabase Clientのクエリビルダのみを使い、ビジネスロジック(名寄せ判定等)は持たない(既存方針`interfaces.ts`冒頭コメント準拠)。

---

## 5. Dry Run構成

既存`buildDryRunResult`(`csvImportPipeline.ts`)とは**別関数として新設**する(既存の売上明細ロジックと混在させない):

```
buildReservationDryRunResult(input, repos)
  │
  ├─ reservationCsvParser.parse(csvText)         … 59列パース・型変換
  ├─ staffResolver.resolveStaffId() × 全行        … 既存流用
  │    └─ brain_staff.user_id → profiles.id マッピング(新規・軽微)
  ├─ customerMatcher.findNameCandidates() × 全行 … 既存流用(氏名のみ)
  ├─ reservationStatusMapper.map() × 全行         … 新規
  └─ ValidationResult相当のプレビュー生成
       (画面表示: 日付・開始時間・終了時間・所要時間・スタッフ・メニュー・
        ステータス・氏名一致状況)
```

既存Dry Runの`needsReview`/`unresolvedStaff`/`skipped`の概念をそのまま踏襲し、UI(`CsvImportScreen.tsx`)の表示コンポーネントも極力共用する。

---

## 6. Import構成

```
runReservationImportPipeline(input, repos)
  │
  for each row:
    ├─ staff解決(unresolved → skip)
    ├─ customer名寄せ(needs_review行はreviewDecisionsに従う。既存パターン踏襲)
    ├─ status変換(未知値 → skip)
    ├─ reservationRepo.findByNaturalKey() で既存行チェック
    │    ├─ 存在する → update()(再取込の冪等更新)
    │    └─ 存在しない → create()
    └─ 集計(newCount/updatedCount/skippedCount等)
  │
  └─ opsLogRepo.insert()(既存パターン踏襲。kind='reservation_csv_import'等で区別)
```

既存`runImportPipeline`との違いは「対象テーブルが`reservations`単体」「`brain_visits`との突合(reconcile)ロジックが不要」という点で、既存より単純な構造になる。

---

## 7. reservations UPSERT設計

RES-2/RES-3確定内容の実装反映:

| 項目 | 設計 |
|---|---|
| UPSERTキー | 暫定複合キー`(staff_id, scheduled_at, brain_customer_id)`(RES-3確定。「予約番号」列は将来追加・Bランク) |
| customer_id(legacy) | 常にNULL(RES-2確定方針) |
| brain_customer_id | customerMatcher結果を格納。候補0件時は新規`brain_customers`作成(RES-3確定) |
| staff_id | `brain_staff.user_id`(=`profiles.id`)を格納(RES-3確定フロー) |
| menu | CSVの`予約時メニュー`をそのままtext格納(menuResolver不要) |
| status | §2の`reservationStatusMapper`変換結果 |
| is_new_customer | CSV列46「このサロンに行くのは初めてですか？」を`true`/`false`変換(RES-3確定マッピング) |
| 再取込時の挙動 | 同一複合キーが既存 → `update()`で上書き(冪等)。**リスケジュール(scheduled_at変更)があった場合は新規行として追加され、旧行は残る**(RES-3で明記済みの既知の限界。予約番号列追加まではこの制約を許容する) |

---

## 8. 既存CSV取込との共存方法

**核心となる分岐点**: `src/components/admin/csv-import/CsvImportScreen.tsx:174`

```ts
// 現状(売上明細CSV以外は実行不可):
if (validation.csvType !== 'detail') return false

// 変更後の設計案:
if (validation.csvType === 'unknown') return false
// 'detail' と 'reservation' はそれぞれ別のAPIエンドポイントへ振り分けて実行可能にする
```

- **エンドポイント分離**: `/api/admin/csv/dry-run`・`/api/admin/csv/import`(既存・売上明細専用、無変更)と、`/api/admin/csv/reservation-dry-run`・`/api/admin/csv/reservation-import`(新規・予約専用)を完全に分離する。同一エンドポイントに分岐ロジックを混在させない(既存の売上明細インポートに一切影響を与えないことを最優先する設計)。
- **UI**: `csvTypeDetector.ts`による自動判定結果(`detail`/`reservation`/`unknown`)に応じて、`CsvImportScreen.tsx`が呼び出すAPIをスイッチする。プレビュー表示コンポーネントは列構成が異なるため、`csvType`ごとに専用のプレビュー行コンポーネントを出し分ける(既存`PreviewRow`型とは別に予約用の型を新設)。
- **`brain_ops_logs`への記録**: `kind`列で`csv_import`(既存・売上明細)と`reservation_csv_import`(新規)を区別し、取込履歴画面(`csv/history`)での混同を防ぐ(`csv/history`側の表示分岐は本計画のスコープ外・別途確認要)。

---

## 9. MD-5「時間帯別来店数」「稼働分数推移」が利用可能になる時点

現状の依存関係を踏まえた到達順序:

```
① §2-8の実装完了(予約CSV取込パイプライン稼働)
     │
     ▼
② 実際に予約CSVが最低1回取り込まれ、reservationsに実データが蓄積される
     │  (自然発生的な蓄積を待つのではなく、運用開始時に既存の予約一覧CSVを
     │   初回まとめて取込むオペレーションが必要)
     ▼
③ OccupancyRepo.hourlyVisits() / occupancyTrend() の実装(§3 修正ファイル一覧)
     │
     ▼
④ app/api/admin/occupancy/route.ts の available:false 分岐を実値へ切替
     │
     ▼
⑤ 「時間帯別来店数」「稼働分数推移(Tier1)」がMD-5画面で表示可能になる
```

**重要**: 「稼働率(%)」(Tier2、`brain_business_settings.seat_capacity`ベース)は本計画の範囲外であり、上記⑤の時点でもTier1(稼働分数の推移)までしか表示できない。真の稼働率%表示にはRES-2 §7で述べた別タスク(seat_capacity設定機能の実装)が別途必要。

**最短到達時点の目安**: ①〜④の実装完了直後にはデータが0件のため画面上は「データなし」表示になる。実際に意味のある数値が出るのは、②の初回まとめ取込が完了した直後から。

---

## 10. 実装工数

| フェーズ | 内容 | 見積 |
|---|---|---|
| Ⅰ. パーサー・変換ロジック | `reservationCsvParser.ts`・`reservationStatusMapper.ts`・staff/customer解決の呼び出し組み立て | 中 |
| Ⅱ. Repository層 | `IReservationRepo`定義・`ReservationRepo`実装・`repos.ts`配線 | 小〜中 |
| Ⅲ. Dry Run API | `buildReservationDryRunResult`・`reservation-dry-run/route.ts` | 中 |
| Ⅳ. Import API | `runReservationImportPipeline`・`reservation-import/route.ts` | 中 |
| Ⅴ. UI統合 | `CsvImportScreen.tsx`分岐・予約用プレビュー型/コンポーネント | 中 |
| Ⅵ. MD-5接続 | `OccupancyRepo`拡張・`occupancy/route.ts`分岐差し替え | 中 |
| Ⅶ. テスト | 新規4ファイル相当(パーサー・Repo・Dry Run/Import API・occupancy) | 中 |

**総合見積: 中〜大**(RES-2時点の見積を維持。個々のフェーズはいずれも既存パターンの横展開のため「大」に達する要素は少ないが、フェーズ数が多く積算すると相応の規模になる)

**最大の分岐要因(変わらず)**: 「予約番号」列追加マイグレーションを本計画と同時に行うかどうか。今回の計画は**追加しない前提**(暫定複合キー運用)でⅠ〜Ⅶを見積もっている。追加する場合はDDLマイグレーション+`findByNaturalKey`のロジック差し替えが追加で必要になり、規模は「大」に拡大する。

---

## 未実施であることの確認

本計画書の作成にあたり、コード変更・DDL適用・コミットは一切行っていません(`git status`で本ファイル追加以外の差分がないことを確認済み)。
